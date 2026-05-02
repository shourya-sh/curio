#all link routes
from logger import get_logger
from fastapi import APIRouter, Depends, HTTPException
from models.link_models import LinkCreate, LinkRestorePayload, LinkUpdate
from sqlalchemy.orm import Session
from db import get_db
from services import graph_service
from services.session_identifiers import resolve_session_pk_or_404


router = APIRouter(prefix="/sessions/{session_id}/links", tags=["links"])
logger = get_logger("link_router")


@router.get("/")
def list_links(session_id: str, db: Session = Depends(get_db)):
    from models.tables import NodeLinkTable
    sid = resolve_session_pk_or_404(session_id, db)
    return db.query(NodeLinkTable).filter_by(session_id=sid).all()


@router.post("/")
def create_link(session_id: str, body: LinkCreate, db: Session = Depends(get_db)):
    sid = resolve_session_pk_or_404(session_id, db)
    link = graph_service.create_link(
        db,
        session_id=str(sid),
        parent_id=body.parent_id,
        child_id=body.child_id,
        color=body.color,
        line_style=body.line_style,
    )
    db.commit()
    db.refresh(link)
    return link


@router.patch("/{link_id}")
def update_link(session_id: str, link_id: str, body: LinkUpdate, db: Session = Depends(get_db)):
    sid = resolve_session_pk_or_404(session_id, db)
    link = graph_service.update_link(
        db,
        str(sid),
        link_id,
        **body.model_dump(exclude_unset=True),
    )
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    db.commit()
    db.refresh(link)
    return link


@router.delete("/{link_id}")
def delete_link(session_id: str, link_id: str, db: Session = Depends(get_db)):
    sid = resolve_session_pk_or_404(session_id, db)
    if not graph_service.delete_link(db, str(sid), link_id):
        raise HTTPException(status_code=404, detail="Link not found")
    db.commit()
    return {"detail": "deleted"}


@router.post("/{link_id}/restore")
def restore_link(session_id: str, link_id: str, body: LinkRestorePayload, db: Session = Depends(get_db)):
    sid = resolve_session_pk_or_404(session_id, db)
    if str(body.id) != str(link_id):
        raise HTTPException(status_code=400, detail="Link id mismatch")
    try:
        link = graph_service.restore_link(db, str(sid), body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    db.refresh(link)
    return link
