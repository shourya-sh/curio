"""Profile endpoints: GET / PATCH / DELETE for the authenticated user."""

import json
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_user
from db import get_db
from encryption import encrypt, decrypt
from logger import get_logger
from models.profile_models import ProfileOut, ProfileUpdate

router = APIRouter(prefix="/profile", tags=["profile"])
logger = get_logger("profile_router")


def _row_to_profile_out(row) -> ProfileOut:
    """Convert a raw DB row (dict-like) to ProfileOut, decrypting keys."""
    gemini_raw = row["gemini_api_keys"]
    gemini_keys: list[str] = []
    if gemini_raw:
        try:
            decrypted = decrypt(gemini_raw)
            gemini_keys = json.loads(decrypted)
        except Exception:
            gemini_keys = []

    has_azure = bool(row.get("azure_foundry_url") and row.get("azure_foundry_api_key"))

    return ProfileOut(
        id=str(row["id"]),
        display_name=row.get("display_name"),
        gemini_api_keys=gemini_keys,
        has_azure=has_azure,
        updated_at=row.get("updated_at"),
    )


def _ensure_profile(db: Session, user_id: str):
    """Auto-create profile row if the Supabase trigger didn't fire (e.g. test users)."""
    result = db.execute(
        text("SELECT id FROM profiles WHERE id = :uid"),
        {"uid": user_id},
    )
    if not result.first():
        db.execute(
            text("INSERT INTO profiles (id) VALUES (:uid) ON CONFLICT (id) DO NOTHING"),
            {"uid": user_id},
        )
        db.commit()


@router.get("/", response_model=ProfileOut)
def get_profile(db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    _ensure_profile(db, user_id)
    result = db.execute(
        text("SELECT id, display_name, gemini_api_keys, azure_foundry_url, azure_foundry_api_key, updated_at FROM profiles WHERE id = :uid"),
        {"uid": user_id},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _row_to_profile_out(row)


@router.patch("/", response_model=ProfileOut)
def update_profile(body: ProfileUpdate, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    _ensure_profile(db, user_id)
    # Build SET clauses dynamically
    updates: dict[str, str | None] = {}
    params: dict = {"uid": user_id}

    if body.display_name is not None:
        updates["display_name"] = ":display_name"
        params["display_name"] = body.display_name

    if body.gemini_api_keys is not None:
        updates["gemini_api_keys"] = ":gemini_api_keys"
        # Filter empty strings, encrypt the JSON list
        clean_keys = [k.strip() for k in body.gemini_api_keys if k.strip()]
        params["gemini_api_keys"] = encrypt(json.dumps(clean_keys)) if clean_keys else None

    if body.azure_foundry_url is not None:
        updates["azure_foundry_url"] = ":azure_foundry_url"
        params["azure_foundry_url"] = encrypt(body.azure_foundry_url) if body.azure_foundry_url.strip() else None

    if body.azure_foundry_api_key is not None:
        updates["azure_foundry_api_key"] = ":azure_foundry_api_key"
        params["azure_foundry_api_key"] = encrypt(body.azure_foundry_api_key) if body.azure_foundry_api_key.strip() else None

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{col} = {placeholder}" for col, placeholder in updates.items())
    set_clause += ", updated_at = NOW()"

    db.execute(text(f"UPDATE profiles SET {set_clause} WHERE id = :uid"), params)
    db.commit()

    # Re-fetch
    result = db.execute(
        text("SELECT id, display_name, gemini_api_keys, azure_foundry_url, azure_foundry_api_key, updated_at FROM profiles WHERE id = :uid"),
        {"uid": user_id},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _row_to_profile_out(row)


@router.delete("/")
def delete_profile(db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    # 1. Delete all user sessions (FK CASCADE handles nodes/links/messages)
    db.execute(text("DELETE FROM sessions WHERE user_id = :uid"), {"uid": user_id})
    # 2. Delete profile row
    db.execute(text("DELETE FROM profiles WHERE id = :uid"), {"uid": user_id})
    db.commit()

    # 3. Delete auth.users row via Supabase Admin API
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if supabase_url and service_key:
        try:
            resp = httpx.delete(
                f"{supabase_url}/auth/v1/admin/users/{user_id}",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                },
                timeout=10,
            )
            if resp.status_code >= 400:
                logger.error("Supabase admin delete failed (%s): %s", resp.status_code, resp.text)
        except Exception as e:
            logger.error("Supabase admin delete error: %s", e)
    else:
        logger.warning("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — auth.users row not deleted")

    return {"detail": "Account deleted"}
