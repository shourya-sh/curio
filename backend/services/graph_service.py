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
    depth: int | None = None,
) -> NodeTable:
    st = subtopics if subtopics is not None else []
    resolved_depth = depth
    if resolved_depth is None and parent_id:
        parent = db.query(NodeTable).filter_by(id=parent_id, session_id=session_id).first()
        resolved_depth = (parent.depth + 1) if parent else 0
    node = NodeTable(
        session_id=session_id,
        topic=topic,
        summary=summary,
        details=details,
        subtopics=st,
        depth=resolved_depth or 0,
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


def create_link(
    db: Session,
    session_id: str,
    parent_id: str,
    child_id: str,
    color: str | None = None,
    line_style: str | None = None,
) -> NodeLinkTable:
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
        color=color,
        line_style=line_style or "solid",
    )
    db.add(link)
    touch_session(db, session_id)
    return link


def update_link(db: Session, session_id: str, link_id: str, **fields) -> NodeLinkTable | None:
    link = db.query(NodeLinkTable).filter_by(id=link_id, session_id=session_id).first()
    if not link:
        return None
    for field, value in fields.items():
        setattr(link, field, value)
    touch_session(db, session_id)
    return link


def delete_link(db: Session, session_id: str, link_id: str) -> bool:
    link = db.query(NodeLinkTable).filter_by(id=link_id, session_id=session_id).first()
    if not link:
        return False
    db.delete(link)
    touch_session(db, session_id)
    return True


def restore_link(db: Session, session_id: str, link_data: dict) -> NodeLinkTable:
    """Restore a deleted link deterministically, preserving id when possible."""
    link_id = link_data["id"]
    parent_id = link_data["parent_id"]
    child_id = link_data["child_id"]

    if parent_id == child_id:
        raise ValueError("Self links are not allowed")

    parent = db.query(NodeTable).filter_by(id=parent_id, session_id=session_id).first()
    child = db.query(NodeTable).filter_by(id=child_id, session_id=session_id).first()
    if not parent or not child:
        raise ValueError("Link endpoints do not exist")

    existing_by_edge = (
        db.query(NodeLinkTable)
        .filter_by(session_id=session_id, parent_id=parent_id, child_id=child_id)
        .first()
    )
    if existing_by_edge:
        return existing_by_edge

    existing_by_id = db.query(NodeLinkTable).filter_by(id=link_id, session_id=session_id).first()
    if existing_by_id:
        return existing_by_id

    allowed_keys = ("id", "parent_id", "child_id", "color", "line_style", "created_at")
    clean = {k: v for k, v in link_data.items() if k in allowed_keys}
    if not clean.get("line_style"):
        clean["line_style"] = "solid"
    link = NodeLinkTable(session_id=session_id, **clean)
    db.add(link)
    touch_session(db, session_id)
    return link


def restore_deleted_node(db: Session, session_id: str, node_data: dict, links_data: list[dict]) -> NodeTable:
    """
    Restore a previously deleted node and selected links deterministically.
    If the node (or a link id) already exists, update/skip rather than duplicating.
    """
    node = db.query(NodeTable).filter_by(id=node_data["id"], session_id=session_id).first()
    if node:
        for field, value in node_data.items():
            if field in {"id", "session_id"}:
                continue
            setattr(node, field, value)
    else:
        node = NodeTable(session_id=session_id, **node_data)
        db.add(node)
        db.flush()

    for link_data in links_data:
        parent_id = link_data["parent_id"]
        child_id = link_data["child_id"]
        if parent_id == child_id:
            continue
        parent = db.query(NodeTable).filter_by(id=parent_id, session_id=session_id).first()
        child = db.query(NodeTable).filter_by(id=child_id, session_id=session_id).first()
        if not parent or not child:
            continue
        exists = (
            db.query(NodeLinkTable)
            .filter_by(session_id=session_id, parent_id=parent_id, child_id=child_id)
            .first()
        )
        if exists:
            continue
        if link_data.get("id") is not None:
            by_id = db.query(NodeLinkTable).filter_by(id=link_data["id"], session_id=session_id).first()
            if by_id:
                continue
        allowed_keys = ("id", "parent_id", "child_id", "color", "line_style", "created_at")
        clean = {k: v for k, v in link_data.items() if k in allowed_keys}
        if not clean.get("line_style"):
            clean["line_style"] = "solid"
        link = NodeLinkTable(session_id=session_id, **clean)
        db.add(link)

    touch_session(db, session_id)
    return node
