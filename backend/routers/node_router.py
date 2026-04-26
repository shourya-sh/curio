#all nodes, usually for plan mode manual updating
from logger import get_logger
from fastapi import APIRouter, Depends, HTTPException
from models.tables import NodeTable
from models.node_models import NodeCreate, NodeUpdate
from sqlalchemy.orm import Session
from db import get_db
from services import graph_service


router = APIRouter(prefix="/sessions/{session_id}/nodes", tags=["nodes"])
logger = get_logger("node_router")


@router.get("/")
def list_nodes(session_id: str, db: Session = Depends(get_db)):
    return db.query(NodeTable).filter_by(session_id=session_id).all()


@router.get("/{node_id}")
def get_node(session_id: str, node_id: str, db: Session = Depends(get_db)):
    node = db.query(NodeTable).filter_by(id=node_id, session_id=session_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@router.post("/")
def create_node(session_id: str, body: NodeCreate, db: Session = Depends(get_db)):
    node = graph_service.create_node(
        db,
        session_id=session_id,
        topic=body.topic,
        summary=body.summary,
        details=body.details,
        parent_id=body.parent_id,
    )
    db.commit()
    db.refresh(node)
    return node


@router.patch("/{node_id}")
def update_node(session_id: str, node_id: str, body: NodeUpdate, db: Session = Depends(get_db)):
    node = graph_service.update_node(
        db, session_id, node_id,
        **body.model_dump(exclude_unset=True),
    )
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    db.commit()
    db.refresh(node)
    return node


@router.delete("/{node_id}")
def delete_node(session_id: str, node_id: str, db: Session = Depends(get_db)):
    if not graph_service.delete_node(db, session_id, node_id):
        raise HTTPException(status_code=404, detail="Node not found")
    db.commit()
    return {"detail": "deleted"}
