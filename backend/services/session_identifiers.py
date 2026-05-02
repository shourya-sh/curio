"""Human-friendly session slugs for URLs; numeric ids remain the primary key everywhere else."""

from __future__ import annotations

import re

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.tables import SessionTable

_SLUG_MAX_LEN = 200


def slugify_text(raw: str) -> str:
    """Lowercase, hyphen-separated ASCII slug; empty if nothing alphanumeric remains."""
    if not raw:
        return ""
    s = raw.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:_SLUG_MAX_LEN] if s else ""


def base_slug_for_new_session(title: str, slug_source: str | None) -> str:
    """Prefer slug from title; if empty, from optional slug_source (e.g. first prompt); else 'workspace'."""
    base = slugify_text(title)
    if base:
        return base
    if slug_source:
        base = slugify_text(slug_source)
        if base:
            return base
    return "workspace"


def allocate_unique_slug(
    db: Session,
    base: str,
    *,
    exclude_session_id: int | None = None,
) -> str:
    """Reserve a unique sessions.slug, appending -1, -2, … as needed."""
    root = slugify_text(base) or "workspace"
    root = root[:_SLUG_MAX_LEN]
    n = 0
    while True:
        candidate = root if n == 0 else f"{root}-{n}"
        candidate = candidate[:255]
        q = db.query(SessionTable.id).filter(SessionTable.slug == candidate)
        if exclude_session_id is not None:
            q = q.filter(SessionTable.id != exclude_session_id)
        if q.first() is None:
            return candidate
        n += 1


def resolve_session_pk(session_ref: str, db: Session) -> int | None:
    """Resolve public session path segment (slug or numeric id string) to primary key."""
    row = db.query(SessionTable).filter(SessionTable.slug == session_ref).first()
    if row:
        return int(row.id)
    if session_ref.isdigit():
        row = db.query(SessionTable).filter(SessionTable.id == int(session_ref)).first()
        if row:
            return int(row.id)
    return None


def resolve_session_pk_or_404(session_ref: str, db: Session) -> int:
    pk = resolve_session_pk(session_ref, db)
    if pk is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return pk


def get_session_by_ref(session_ref: str, db: Session) -> SessionTable | None:
    row = db.query(SessionTable).filter(SessionTable.slug == session_ref).first()
    if row:
        return row
    if session_ref.isdigit():
        return db.query(SessionTable).filter(SessionTable.id == int(session_ref)).first()
    return None
