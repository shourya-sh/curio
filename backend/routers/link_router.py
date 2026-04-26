#all link routes
from logger import get_logger
from fastapi import APIRouter, Depends, HTTPException
from models.tables import NodeLinkTable
from models.link_models import LinkCreate
from sqlalchemy.orm import Session
from db import get_db


router = APIRouter(prefix="/sessions/{session_id}/links", tags=["links"])
logger = get_logger("link_router")


@router.get("/")
def list_links(session_id: str, db: Session = Depends(get_db)):
    return db.query(NodeLinkTable).filter_by(session_id=session_id).all()


@router.post("/")
def create_link(session_id: str, body: LinkCreate, db: Session = Depends(get_db)):
    link = NodeLinkTable(
        session_id=session_id,
        parent_id=body.parent_id,
        child_id=body.child_id,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.delete("/{link_id}")
def delete_link(session_id: str, link_id: str, db: Session = Depends(get_db)):
    link = db.query(NodeLinkTable).filter_by(id=link_id, session_id=session_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
    return {"detail": "deleted"}
