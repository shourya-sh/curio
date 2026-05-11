"""Terminate any backend connection that is `idle in transaction` for too long.

Such connections hold locks and block DDL like ALTER TABLE. Safe to run.
"""

from sqlalchemy import text

from db import engine

# Anything idle-in-tx for over a minute is fair game.
MIN_AGE = "1 minute"


def main() -> None:
    list_sql = text(
        """
        SELECT pid, age(now(), xact_start) AS age, left(query, 120) AS query
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'idle in transaction'
          AND xact_start < now() - interval :age
          AND pid <> pg_backend_pid()
        """
    )
    kill_sql = text(
        """
        SELECT pid, pg_terminate_backend(pid) AS terminated
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'idle in transaction'
          AND xact_start < now() - interval :age
          AND pid <> pg_backend_pid()
        """
    )
    with engine.connect() as conn:
        targets = conn.execute(list_sql, {"age": MIN_AGE}).fetchall()
        for t in targets:
            print("target:", dict(t._mapping))
        res = conn.execute(kill_sql, {"age": MIN_AGE}).fetchall()
        for r in res:
            print("terminated:", dict(r._mapping))


if __name__ == "__main__":
    main()
