"""Persist chat / sources messages. Routers and stream handlers use this instead of touching ORM tables ad hoc."""

import json

from sqlalchemy.orm import Session

from models.tables import MessageTable, SessionTable
from services.session_identifiers import get_session_by_ref


def get_session_row(db: Session, session_id: int) -> SessionTable | None:
    return db.query(SessionTable).filter_by(id=session_id).first()


def create_user_message(db: Session, session_id: int, content: str) -> MessageTable:
    row = MessageTable(session_id=session_id, role="user", content=content)
    db.add(row)
    db.flush()
    return row


def create_message(db: Session, session_id: int, role: str, content: str) -> MessageTable:
    row = MessageTable(session_id=session_id, role=role, content=content)
    db.add(row)
    db.flush()
    return row


def create_sources_message(db: Session, session_id: int, payload: dict) -> MessageTable:
    row = MessageTable(session_id=session_id, role="sources", content=json.dumps(payload))
    db.add(row)
    db.flush()
    return row
