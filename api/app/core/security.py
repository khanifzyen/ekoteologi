"""Hashing password (bcrypt) + JWT access & refresh token."""

import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.core.config import get_settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _encode(payload: dict) -> str:
    return jwt.encode(payload, get_settings().jwt_secret, algorithm=get_settings().jwt_algorithm)


def create_access_token(user_id: uuid.UUID, role: str) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
        "type": "access",
    }
    return _encode(payload)


def create_refresh_token(user_id: uuid.UUID, expire_days: int, remember: bool = True) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(days=expire_days),
        "type": "refresh",
        "jti": uuid.uuid4().hex,
        "rem": remember,  # dipertahankan saat rotasi agar umur sesi konsisten
    }
    return _encode(payload)


def decode_access_token(token: str) -> dict | None:
    """Kembalikan payload bila valid, selain itu None (tidak melempar)."""
    return _decode(token, expected_type="access")


def decode_refresh_token(token: str) -> dict | None:
    return _decode(token, expected_type="refresh")


def _decode(token: str, expected_type: str) -> dict | None:
    try:
        payload = jwt.decode(
            token, get_settings().jwt_secret, algorithms=[get_settings().jwt_algorithm]
        )
    except jwt.PyJWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    return payload
