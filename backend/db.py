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
    )
    with engine.begin() as conn:
        for sql in statements:
            conn.execute(text(sql))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()