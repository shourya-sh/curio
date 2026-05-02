"""Persist chat / sources messages. Routers and stream handlers use this instead of touching ORM tables ad hoc."""

import json

from sqlalchemy.orm import Session

from models.tables import MessageTable, SessionTable
from services.session_identifiers import get_session_by_ref


def get_session_row(db: Session, session_id: str) -> SessionTable | None:
    return get_session_by_ref(session_id, db)


def create_user_message(db: Session, session_id: str, content: str) -> MessageTable:
    row = MessageTable(session_id=session_id, role="user", content=content)
    db.add(row)
    db.flush()
    return row


def create_message(db: Session, session_id: str, role: str, content: str) -> MessageTable:
    row = MessageTable(session_id=session_id, role=role, content=content)
    db.add(row)
    db.flush()
    return row


def create_sources_message(db: Session, session_id: str, payload: dict) -> MessageTable:
    row = MessageTable(session_id=session_id, role="sources", content=json.dumps(payload))
    db.add(row)
    db.flush()
    return row
