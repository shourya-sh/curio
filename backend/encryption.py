"""Fernet-based encryption for stored API keys.

If ENCRYPTION_KEY is not set, plaintext pass-through is used (dev mode only).
"""

import os

from logger import get_logger

logger = get_logger("encryption")

_fernet = None
_initialized = False


def _get_fernet():
    global _fernet, _initialized
    if _initialized:
        return _fernet
    _initialized = True
    key = os.getenv("ENCRYPTION_KEY", "").strip()
    if not key:
        logger.warning("ENCRYPTION_KEY not set — API keys will be stored in plaintext (dev mode)")
        return None
    try:
        from cryptography.fernet import Fernet
        _fernet = Fernet(key.encode())
    except Exception as e:
        logger.error("Invalid ENCRYPTION_KEY: %s — falling back to plaintext", e)
        _fernet = None
    return _fernet


def encrypt(plaintext: str) -> str:
    f = _get_fernet()
    if f is None:
        return plaintext
    return f.encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    f = _get_fernet()
    if f is None:
        return ciphertext
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except Exception:
        logger.warning("Failed to decrypt value — returning as-is (key mismatch?)")
        return ciphertext
