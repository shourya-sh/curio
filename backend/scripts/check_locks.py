"""Show locks / blockers on the sessions table. Read-only."""

from sqlalchemy import text

from db import engine


SQL = """
SELECT
  pid,
  state,
  wait_event_type,
  wait_event,
  now() - query_start AS age,
  left(query, 200) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
ORDER BY age DESC NULLS LAST
LIMIT 20
"""


def main() -> None:
    with engine.connect() as conn:
        rows = conn.execute(text(SQL)).fetchall()
    for r in rows:
        print(dict(r._mapping))


if __name__ == "__main__":
    main()
