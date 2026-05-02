#all nodes, usually for plan mode manual updating
from logger import get_logger
from fastapi import APIRouter, Depends, HTTPException
from models.tables import NodeTable
from models.node_models import NodeCreate, NodeUpdate, NodeBulkUpdate, NodeRestorePayload
from sqlalchemy.orm import Session
from db import get_db
from services import graph_service
from services.session_identifiers import resolve_session_pk_or_404


router = APIRouter(prefix="/sessions/{session_id}/nodes", tags=["nodes"])
logger = get_logger("node_router")


@router.get("/")
def list_nodes(session_id: str, db: Session = Depends(get_db)):
    sid = resolve_session_pk_or_404(session_id, db)
    return db.query(NodeTable).filter_by(session_id=sid).all()


@router.get("/{node_id}")
def get_node(session_id: str, node_id: str, db: Session = Depends(get_db)):
    sid = resolve_session_pk_or_404(session_id, db)
    node = db.query(NodeTable).filter_by(id=node_id, session_id=sid).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@router.post("/")
def create_node(session_id: str, body: NodeCreate, db: Session = Depends(get_db)):
    sid = resolve_session_pk_or_404(session_id, db)
    node = graph_service.create_node(
        db,
        session_id=str(sid),
        topic=body.topic,
        summary=body.summary,
        details=body.details,
        parent_id=str(body.parent_id) if body.parent_id is not None else None,
        position_x=body.position_x,
        position_y=body.position_y,
        original_position_x=body.original_position_x,
        original_position_y=body.original_position_y,
        node_type=body.node_type,
        color=body.color,
        subtopics=body.subtopics,
        depth=body.depth,
    )
    db.commit()
    db.refresh(node)
    return node


@router.patch("/{node_id}")
def update_node(session_id: str, node_id: str, body: NodeUpdate, db: Session = Depends(get_db)):
    sid = resolve_session_pk_or_404(session_id, db)
    node = graph_service.update_node(
        db, str(sid), node_id,
        **body.model_dump(exclude_unset=True),
    )
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    db.commit()
    db.refresh(node)
    return node


@router.patch("/")
def bulk_update_nodes(session_id: str, body: NodeBulkUpdate, db: Session = Depends(get_db)):
    """Batch-save dirty nodes in a single request (positions, text edits, etc.)."""
    sid = resolve_session_pk_or_404(session_id, db)
    updated = []
    for item in body.nodes:
        fields = item.model_dump(exclude={"id"}, exclude_unset=True)
        if not fields:
            continue
        node = graph_service.update_node(db, str(sid), str(item.id), **fields)
        if node:
            updated.append(node.id)
    db.commit()
    return {"updated": updated}


@router.delete("/{node_id}")
def delete_node(session_id: str, node_id: str, db: Session = Depends(get_db)):
    sid = resolve_session_pk_or_404(session_id, db)
    if not graph_service.delete_node(db, str(sid), node_id):
        raise HTTPException(status_code=404, detail="Node not found")
    db.commit()
    return {"detail": "deleted"}


@router.post("/{node_id}/restore")
def restore_node(session_id: str, node_id: str, body: NodeRestorePayload, db: Session = Depends(get_db)):
    sid = resolve_session_pk_or_404(session_id, db)
    if str(body.node.id) != str(node_id):
        raise HTTPException(status_code=400, detail="Node id mismatch")
    node_dict = body.node.model_dump(exclude_none=True)
    if node_dict.get("original_position_x") is None:
        node_dict["original_position_x"] = node_dict["position_x"]
    if node_dict.get("original_position_y") is None:
        node_dict["original_position_y"] = node_dict["position_y"]
    links = [item.model_dump(exclude_none=True) for item in body.links]
    node = graph_service.restore_deleted_node(db, str(sid), node_dict, links)
    db.commit()
    db.refresh(node)
    return node
