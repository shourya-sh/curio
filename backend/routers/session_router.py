#all session routes
from logger import get_logger
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import StreamingResponse
from models.session_models import (
    NodeOut,
    SessionCreate,
    SessionDetail,
    SessionPrompt,
    SessionRelayout,
    SessionUpdate,
)
from models.tables import SessionTable
from sqlalchemy.orm import Session, joinedload
from db import get_db, SessionLocal

from auth import get_current_user
from services import graph_service, layout_engine
from services.graph_service import verify_session_owner
from services.profile_service import get_user_api_keys
from services.rate_limit import limit_ai_prompt
from services.session_identifiers import allocate_unique_slug, base_slug_for_new_session, resolve_session_pk_or_404
from services.stream_service import run_agent_stream, run_expand_stream


router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = get_logger("session_router")


#create session with title and mode
@router.post("/")
def create_session(body: SessionCreate, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    base = base_slug_for_new_session(body.title, body.slug_source)
    slug = allocate_unique_slug(db, base)
    layout_mode = body.layout_mode if body.layout_mode in layout_engine.LAYOUT_MODES else "radial"
    new_session = SessionTable(
        title=body.title,
        mode=body.mode,
        layout_mode=layout_mode,
        slug=slug,
        user_id=user_id,
    )
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

# update title and/or layout_mode of session
@router.patch("/{session_id}")
def update_session(session_id: str, body: SessionUpdate, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    pk = resolve_session_pk_or_404(session_id, db)
    session = verify_session_owner(db, pk, user_id)
    if body.title is not None:
        session.title = body.title
    if body.layout_mode is not None:
        if body.layout_mode not in layout_engine.LAYOUT_MODES:
            raise HTTPException(status_code=400, detail=f"layout_mode must be one of {layout_engine.LAYOUT_MODES}")
        session.layout_mode = body.layout_mode
    db.commit()
    db.refresh(session)
    return session


# Recompute layout positions for a session and return the moved nodes. Used by
# the LayoutModePanel after switching modes, or as an explicit "tidy up".
@router.post("/{session_id}/relayout")
def relayout_session(
    session_id: str,
    body: SessionRelayout,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    pk = resolve_session_pk_or_404(session_id, db)
    session = verify_session_owner(db, pk, user_id)
    chosen = body.mode if body.mode is not None else session.layout_mode
    if chosen not in layout_engine.LAYOUT_MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of {layout_engine.LAYOUT_MODES}")
    # Persist the chosen mode if it differs (one click both saves + applies).
    if body.mode is not None and body.mode != session.layout_mode:
        session.layout_mode = body.mode
    moves = layout_engine.apply_layout(db, pk, mode=chosen)
    db.commit()
    moved_ids = {nid for nid, _, _ in moves}
    refreshed = [
        NodeOut.model_validate(n).model_dump(mode="json")
        for n in graph_service.list_nodes(db, pk)
        if n.id in moved_ids
    ]
    return {"layout_mode": chosen, "moved": refreshed}

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
    db_pre = SessionLocal()
    try:
        pk = resolve_session_pk_or_404(session_id, db_pre)
        verify_session_owner(db_pre, pk, user_id)
        user_api_keys = get_user_api_keys(db_pre, user_id)
    finally:
        db_pre.close()

    # own DB session — stream outlives the request-scoped one
    db = SessionLocal()
    return StreamingResponse(
        run_agent_stream(pk, body.prompt, db, request, anchor_node_id=body.anchor_node_id, api_keys=user_api_keys),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# expand a specific node — streams SSE events directly from expand agent
@router.post("/{session_id}/nodes/{node_id}/expand")
async def expand_node(
    session_id: str,
    node_id: int,
    request: Request,
    user_id: str = Depends(get_current_user),
    _rate_limit: None = Depends(limit_ai_prompt),
):
    db_pre = SessionLocal()
    try:
        pk = resolve_session_pk_or_404(session_id, db_pre)
        verify_session_owner(db_pre, pk, user_id)
        user_api_keys = get_user_api_keys(db_pre, user_id)
    finally:
        db_pre.close()

    db = SessionLocal()
    return StreamingResponse(
        run_expand_stream(pk, node_id, db, request, api_keys=user_api_keys),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
