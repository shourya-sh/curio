import os

import httpx
import jwt
from jwt import PyJWK
from fastapi import HTTPException, Request
from logger import get_logger

logger = get_logger("auth")

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().strip("'\"").rstrip("/")

# JWKS cache for ES256 verification (newer Supabase projects)
_jwks_keys: dict[str, PyJWK] = {}
_jwks_fetched = False


def _fetch_jwks() -> None:
    """Fetch JWKS from Supabase (once). Newer Supabase projects sign user JWTs
    with ES256 instead of HS256, so we need the public key for verification."""
    global _jwks_fetched
    if _jwks_fetched:
        return
    _jwks_fetched = True

    if not SUPABASE_URL:
        logger.info("SUPABASE_URL not set — JWKS fetch skipped, will use HS256 only")
        return

    jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    try:
        resp = httpx.get(jwks_url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        for key_data in data.get("keys", []):
            kid = key_data.get("kid")
            if kid:
                _jwks_keys[kid] = PyJWK(key_data)
        if _jwks_keys:
            logger.info("Loaded %d JWKS key(s) from Supabase (ES256)", len(_jwks_keys))
        else:
            logger.info("No JWKS keys found — will use HS256 with JWT secret")
    except Exception as e:
        logger.warning("Failed to fetch JWKS from %s: %s — will use HS256", jwks_url, e)


if not SUPABASE_JWT_SECRET and not SUPABASE_URL:
    logger.error("Neither SUPABASE_JWT_SECRET nor SUPABASE_URL set — all auth will fail")


def get_current_user(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header[7:]

    # Peek at the token header to determine the algorithm
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.DecodeError:
        raise HTTPException(status_code=401, detail="Malformed token")

    alg = unverified_header.get("alg", "")
    kid = unverified_header.get("kid")

    try:
        if alg == "ES256" and kid:
            # Newer Supabase: asymmetric JWT signed with ES256
            _fetch_jwks()
            jwk = _jwks_keys.get(kid)
            if not jwk:
                logger.error("No JWKS key found for kid=%s", kid)
                raise HTTPException(status_code=401, detail="Unknown signing key")
            payload = jwt.decode(
                token,
                jwk.key,
                algorithms=["ES256"],
                audience="authenticated",
            )
        else:
            # Legacy Supabase: symmetric JWT signed with HS256
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        logger.error("JWT decode failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing sub claim")

    return user_id
