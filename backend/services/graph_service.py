from datetime import datetime, timezone

from models.tables import NodeTable, NodeLinkTable, SessionTable
from sqlalchemy.orm import Session


def touch_session(db: Session, session_id: str) -> None:
    """Bump parent session updated_at when graph data changes (nodes/links)."""
    row = db.query(SessionTable).filter_by(id=session_id).first()
    if row:
        row.updated_at = datetime.now(timezone.utc)


def create_node(
    db: Session,
    session_id: str,
    topic: str,
    summary: str = None,
    details: str = None,
    parent_id: str = None,
    position_x: float = 0,
    position_y: float = 0,
    node_type: str = "topic",
    color: str = None,
    subtopics=None,
) -> NodeTable:
    st = subtopics if subtopics is not None else []
    node = NodeTable(
        session_id=session_id,
        topic=topic,
        summary=summary,
        details=details,
        subtopics=st,
        position_x=position_x,
        position_y=position_y,
        node_type=node_type,
        color=color,
    )
    db.add(node)
    db.flush()

    if parent_id:
        link = NodeLinkTable(
            session_id=session_id,
            parent_id=parent_id,
            child_id=str(node.id),
        )
        db.add(link)

    touch_session(db, session_id)
    return node


def update_node(db: Session, session_id: str, node_id: str, **fields) -> NodeTable | None:
    node = db.query(NodeTable).filter_by(id=node_id, session_id=session_id).first()
    if not node:
        return None

    for field, value in fields.items():
        setattr(node, field, value)

    touch_session(db, session_id)
    return node


def delete_node(db: Session, session_id: str, node_id: str) -> bool:
    node = db.query(NodeTable).filter_by(id=node_id, session_id=session_id).first()
    if not node:
        return False
    db.delete(node)
    touch_session(db, session_id)
    return True


def create_link(db: Session, session_id: str, parent_id: str, child_id: str) -> NodeLinkTable:
    """Create a parent→child link. If the same edge already exists, return the existing row (idempotent)."""
    existing = (
        db.query(NodeLinkTable)
        .filter_by(
            session_id=session_id,
            parent_id=parent_id,
            child_id=child_id,
        )
        .first()
    )
    if existing:
        touch_session(db, session_id)
        return existing

    link = NodeLinkTable(
        session_id=session_id,
        parent_id=parent_id,
        child_id=child_id,
    )
    db.add(link)
    touch_session(db, session_id)
    return link


def delete_link(db: Session, session_id: str, link_id: str) -> bool:
    link = db.query(NodeLinkTable).filter_by(id=link_id, session_id=session_id).first()
    if not link:
        return False
    db.delete(link)
    touch_session(db, session_id)
    return True
