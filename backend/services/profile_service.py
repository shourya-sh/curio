"""User profile helpers (BYOK key lookup, etc.)."""

import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from encryption import decrypt


def get_user_api_keys(db: Session, user_id: str) -> list[str] | None:
    """Return the user's decrypted Gemini API keys, or None if not configured."""
    result = db.execute(
        text("SELECT gemini_api_keys FROM profiles WHERE id = :uid"),
        {"uid": user_id},
    )
    row = result.mappings().first()
    if not row or not row["gemini_api_keys"]:
        return None
    try:
        decrypted = decrypt(row["gemini_api_keys"])
        keys = json.loads(decrypted)
        return keys if keys else None
    except Exception:
        return None
