#all session routes
from logger import get_logger
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import StreamingResponse
from models.session_models import SessionCreate, SessionUpdate, SessionPrompt, SessionDetail
from models.tables import SessionTable
from sqlalchemy.orm import Session, joinedload
from db import get_db, SessionLocal
from services.rate_limit import limit_ai_prompt
from services.session_identifiers import allocate_unique_slug, base_slug_for_new_session, resolve_session_pk_or_404
from services.stream_service import run_agent_stream


router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = get_logger("session_router")

#create session with title and mode
@router.post("/")
def create_session(body: SessionCreate, db: Session = Depends(get_db)):
    base = base_slug_for_new_session(body.title, body.slug_source)
    slug = allocate_unique_slug(db, base)
    new_session = SessionTable(title=body.title, mode=body.mode, slug=slug)
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return new_session

# get list of sessions
@router.get("/")
def list_sessions(db: Session = Depends(get_db)):
    return db.query(SessionTable).order_by(SessionTable.updated_at.desc()).all()

# get session by slug or numeric id (path segment); internal FKs stay numeric
@router.get("/{session_id}", response_model=SessionDetail)
def get_session(session_id: str, db: Session = Depends(get_db)):
    pk = resolve_session_pk_or_404(session_id, db)
    session = (
        db.query(SessionTable)
        .options(joinedload(SessionTable.nodes), joinedload(SessionTable.links), joinedload(SessionTable.messages))
        .filter_by(id=pk)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.messages:
        session.messages.sort(key=lambda m: (m.created_at.timestamp() if m.created_at else 0, m.id))
    return session

# update title of session
@router.patch("/{session_id}")
def update_session(session_id: str, body: SessionUpdate, db: Session = Depends(get_db)):
    pk = resolve_session_pk_or_404(session_id, db)
    session = db.query(SessionTable).filter_by(id=pk).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.title = body.title
    db.commit()
    db.refresh(session)
    return session

# delete session, cascades to nodes and links + chat histoire
@router.delete("/{session_id}")
def delete_session(session_id: str, db: Session = Depends(get_db)):
    pk = resolve_session_pk_or_404(session_id, db)
    session = db.query(SessionTable).filter_by(id=pk).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()
    return {"detail": "deleted"}

# prompt a sessionstreams SSE events (node_created, link_created, done/error)
@router.post("/{session_id}/prompt")
async def session_prompt(
    session_id: str,
    body: SessionPrompt,
    request: Request,
    _rate_limit: None = Depends(limit_ai_prompt),
):
    db_resolve = SessionLocal()
    try:
        pk = resolve_session_pk_or_404(session_id, db_resolve)
    finally:
        db_resolve.close()
    # own DB session — stream outlives the request-scoped one
    db = SessionLocal()
    return StreamingResponse(
        run_agent_stream(str(pk), body.prompt, db, request, anchor_node_id=body.anchor_node_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
