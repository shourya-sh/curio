"""Apply idempotent DDL for node_links.color and node_links.line_style."""
from pathlib import Path

from dotenv import load_dotenv
import os
from sqlalchemy import create_engine, text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / "migrations" / "add_link_color_line_style.sql"


def main() -> None:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set in backend/.env")
    url = url.strip().strip("'").strip('"')
    engine = create_engine(url)
    sql = MIGRATION.read_text(encoding="utf-8")
    statements = []
    for block in sql.split(";"):
        line = block.strip()
        if not line or line.startswith("--"):
            continue
        statements.append(line)
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
    print("Migration OK:", MIGRATION.name)


if __name__ == "__main__":
    main()
