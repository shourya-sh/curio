#all session routes
from logger import get_logger
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import StreamingResponse
from models.session_models import SessionCreate, SessionUpdate, SessionPrompt, SessionDetail
from models.tables import SessionTable
from sqlalchemy.orm import Session, joinedload
from db import get_db, SessionLocal
import json

from auth import get_current_user
from encryption import decrypt
from services.graph_service import verify_session_owner
from services.rate_limit import limit_ai_prompt
from services.session_identifiers import allocate_unique_slug, base_slug_for_new_session, resolve_session_pk_or_404
from services.stream_service import run_agent_stream
from sqlalchemy import text


router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = get_logger("session_router")


#create session with title and mode
@router.post("/")
def create_session(body: SessionCreate, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    base = base_slug_for_new_session(body.title, body.slug_source)
    slug = allocate_unique_slug(db, base)
    new_session = SessionTable(title=body.title, mode=body.mode, slug=slug, user_id=user_id)
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return new_session

# get list of sessions
@router.get("/")
def list_sessions(db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    return db.query(SessionTable).filter(SessionTable.user_id == user_id).order_by(SessionTable.updated_at.desc()).all()

# get session by slug or numeric id (path segment); internal FKs stay numeric
@router.get("/{session_id}", response_model=SessionDetail)
def get_session(session_id: str, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    pk = resolve_session_pk_or_404(session_id, db)
    session = (
        db.query(SessionTable)
        .options(joinedload(SessionTable.nodes), joinedload(SessionTable.links), joinedload(SessionTable.messages))
        .filter_by(id=pk)
        .first()
    )
    if not session or str(session.user_id) != user_id:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.messages:
        session.messages.sort(key=lambda m: (m.created_at.timestamp() if m.created_at else 0, m.id))
    return session

# update title of session
@router.patch("/{session_id}")
def update_session(session_id: str, body: SessionUpdate, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    pk = resolve_session_pk_or_404(session_id, db)
    session = verify_session_owner(db, pk, user_id)
    session.title = body.title
    db.commit()
    db.refresh(session)
    return session

# delete session, cascades to nodes and links + chat histoire
@router.delete("/{session_id}")
def delete_session(session_id: str, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    pk = resolve_session_pk_or_404(session_id, db)
    session = verify_session_owner(db, pk, user_id)
    db.delete(session)
    db.commit()
    return {"detail": "deleted"}

# prompt a session — streams SSE events (node_created, link_created, done/error)
@router.post("/{session_id}/prompt")
async def session_prompt(
    session_id: str,
    body: SessionPrompt,
    request: Request,
    user_id: str = Depends(get_current_user),
    _rate_limit: None = Depends(limit_ai_prompt),
):
    db_resolve = SessionLocal()
    try:
        pk = resolve_session_pk_or_404(session_id, db_resolve)
        verify_session_owner(db_resolve, pk, user_id)
    finally:
        db_resolve.close()
    # Look up user's BYOK keys
    user_api_keys: list[str] | None = None
    db_keys = SessionLocal()
    try:
        result = db_keys.execute(
            text("SELECT gemini_api_keys FROM profiles WHERE id = :uid"),
            {"uid": user_id},
        )
        row = result.mappings().first()
        if row and row["gemini_api_keys"]:
            try:
                decrypted = decrypt(row["gemini_api_keys"])
                keys = json.loads(decrypted)
                if keys:
                    user_api_keys = keys
            except Exception:
                pass
    finally:
        db_keys.close()

    # own DB session — stream outlives the request-scoped one
    db = SessionLocal()
    return StreamingResponse(
        run_agent_stream(str(pk), body.prompt, db, request, anchor_node_id=body.anchor_node_id, api_keys=user_api_keys),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
