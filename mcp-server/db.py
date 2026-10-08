"""Read-only access to the backend's loans.db. The MCP server must never write to this database."""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "backend-layer" / "loans.db"


def connect() -> sqlite3.Connection:
    # mode=ro: even a bug in our own code cannot write to the database.
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def find_loan(loan_id: int) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM loans WHERE id = ?", (loan_id,)).fetchone()
        return dict(row) if row else None


def calls_today(loan_id: int, today: str) -> int:
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM calls WHERE loan_id = ? AND substr(started_at, 1, 10) = ?", (loan_id, today)
        ).fetchone()
        return row["n"]