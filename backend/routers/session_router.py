#all session routes
from logger import get_logger
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import StreamingResponse
from models.session_models import SessionCreate, SessionUpdate, SessionPrompt, SessionDetail
from models.tables import SessionTable
from sqlalchemy.orm import Session, joinedload
from db import get_db, SessionLocal
from services.rate_limit import limit_ai_prompt
from services.stream_service import run_agent_stream


router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = get_logger("session_router")

#create session with title and mode
@router.post("/")
def create_session(body: SessionCreate, db: Session = Depends(get_db)):
    new_session = SessionTable(title=body.title, mode=body.mode)
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return new_session

# get list of sessions
@router.get("/")
def list_sessions(db: Session = Depends(get_db)):
    return db.query(SessionTable).order_by(SessionTable.updated_at.desc()).all()

# get session by id all data loaded and returned
@router.get("/{session_id}", response_model=SessionDetail)
def get_session(session_id: str, db: Session = Depends(get_db)):
    session = (
        db.query(SessionTable)
        .options(joinedload(SessionTable.nodes), joinedload(SessionTable.links), joinedload(SessionTable.messages))
        .filter_by(id=session_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

# update title of session
@router.patch("/{session_id}")
def update_session(session_id: str, body: SessionUpdate, db: Session = Depends(get_db)):
    session = db.query(SessionTable).filter_by(id=session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.title = body.title
    db.commit()
    db.refresh(session)
    return session

# delete session, cascades to nodes and links + chat histoire
@router.delete("/{session_id}")
def delete_session(session_id: str, db: Session = Depends(get_db)):
    session = db.query(SessionTable).filter_by(id=session_id).first()
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
    # own DB session — stream outlives the request-scoped one
    db = SessionLocal()
    return StreamingResponse(
        run_agent_stream(session_id, body.prompt, db, request, anchor_node_id=body.anchor_node_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
