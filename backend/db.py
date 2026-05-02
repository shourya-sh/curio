from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import QueuePool
import os

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set")

engine = create_engine(
    DATABASE_URL,
    poolclass=QueuePool,
    pool_size=5,
    max_overflow=10,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def ensure_schema() -> None:
    """
    Apply idempotent DDL so the live database matches SQLAlchemy models.
    Prevents query crashes when migrations were not run against this DATABASE_URL
    (e.g. Supabase session pooler vs local, or a fresh clone).
    """
    from sqlalchemy import text

    statements = (
        "ALTER TABLE node_links ADD COLUMN IF NOT EXISTS color VARCHAR(20)",
        "ALTER TABLE node_links ADD COLUMN IF NOT EXISTS line_style VARCHAR(20) NOT NULL DEFAULT 'solid'",
        "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS original_position_x DOUBLE PRECISION",
        "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS original_position_y DOUBLE PRECISION",
        "UPDATE nodes SET original_position_x = position_x WHERE original_position_x IS NULL",
        "UPDATE nodes SET original_position_y = position_y WHERE original_position_y IS NULL",
        "ALTER TABLE nodes ALTER COLUMN original_position_x SET DEFAULT 0",
        "ALTER TABLE nodes ALTER COLUMN original_position_y SET DEFAULT 0",
        "ALTER TABLE nodes ALTER COLUMN original_position_x SET NOT NULL",
        "ALTER TABLE nodes ALTER COLUMN original_position_y SET NOT NULL",
        "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS slug VARCHAR(255)",
    )
    with engine.begin() as conn:
        for sql in statements:
            conn.execute(text(sql))

    _backfill_session_slugs()
    with engine.begin() as conn:
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_slug ON sessions (slug)"))
        conn.execute(text("ALTER TABLE sessions ALTER COLUMN slug SET NOT NULL"))


def _backfill_session_slugs() -> None:
    from models.tables import SessionTable
    from services.session_identifiers import allocate_unique_slug, slugify_text

    db = SessionLocal()
    try:
        rows = db.query(SessionTable).order_by(SessionTable.id.asc()).all()
        for row in rows:
            if row.slug and str(row.slug).strip():
                continue
            base = slugify_text(row.title) or "workspace"
            row.slug = allocate_unique_slug(db, base, exclude_session_id=int(row.id))
        for row in db.query(SessionTable).order_by(SessionTable.id.asc()).all():
            if row.slug and str(row.slug).strip():
                continue
            row.slug = allocate_unique_slug(db, f"session-{row.id}", exclude_session_id=int(row.id))
        db.commit()
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()