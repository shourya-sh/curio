"""One-off migration: add `layout_mode` column to `sessions`.

Idempotent. Safe to run multiple times. Run with:
    docker exec -w /app curio-backend-1 python -m scripts.migrate_add_layout_mode

Splits the change into 4 metadata-only steps so the Supabase pooler's
statement_timeout never bites us. Each step is its own transaction.
"""

from sqlalchemy import text

from db import engine


def main() -> None:
    steps = [
        "SET statement_timeout = '120s'",
        # 1. Add the column nullable, with a default — metadata-only in PG11+.
        "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS layout_mode VARCHAR(20) DEFAULT 'radial'",
        # 2. Backfill any NULLs (cheap; should be zero rows because of DEFAULT).
        "UPDATE sessions SET layout_mode = 'radial' WHERE layout_mode IS NULL",
        # 3. Promote to NOT NULL now that every row is non-null.
        "ALTER TABLE sessions ALTER COLUMN layout_mode SET NOT NULL",
    ]
    with engine.connect() as conn:
        for sql in steps:
            print("→", sql)
            with conn.begin():
                conn.execute(text(sql))

    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT column_name, data_type, column_default, is_nullable "
                "FROM information_schema.columns "
                "WHERE table_name = 'sessions' AND column_name = 'layout_mode'"
            )
        ).fetchone()
    if row is None:
        raise SystemExit("Migration ran but column did not appear — something is wrong.")
    print("layout_mode column OK:", dict(row._mapping))


if __name__ == "__main__":
    main()
