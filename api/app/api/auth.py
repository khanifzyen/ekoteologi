"""Auth Sprint 1: register, login + rate limit, JWT refresh, Google Sign-In.

Alur token: login/register/google mengembalikan pasangan access (umur pendek)
+ refresh (JWT type=refresh, rotasi tiap `POST /v1/auth/refresh`). Refresh
bersifat stateless — pembatalan sesi dilakukan lewat `is_active=false`.
"""

import math
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user, get_db, get_redis_dep
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from app.models import User
from app.schemas.auth import (
    GoogleAuthRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserPublic,
)
from app.services import google as google_service
from app.services import rate_limit
from app.services.audit import record_audit

router = APIRouter(prefix="/v1/auth", tags=["auth"])


def _issue_tokens(user: User, remember: bool = True) -> TokenResponse:
    settings = get_settings()
    days = (
        settings.refresh_token_expire_days if remember else settings.refresh_token_expire_days_short
    )
    return TokenResponse(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id, days, remember=remember),
        user=UserPublic.model_validate(user),
    )


def _client_ip(request: Request) -> str:
    """IP klien; X-Forwarded-For dipercaya hanya hop pertama (proxy terbalik)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    email = payload.email.lower()
    existing = (await db.scalars(select(User).where(User.email == email))).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email sudah terdaftar. Silakan masuk atau gunakan email lain.",
        )

    user = User(
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        role="user",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    await record_audit(
        db,
        actor_id=user.id,
        action="register",
        entity="auth",
        entity_id=user.id,
        diff={"provider": "password", "email": email},
    )
    return _issue_tokens(user, remember=True)


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    email = payload.email.lower()
    ip = _client_ip(request)
    redis = get_redis_dep()

    allowed, wait_seconds = await rate_limit.check_login_allowed(redis, email, ip)
    if not allowed:
        minutes = max(1, math.ceil(wait_seconds / 60))
        await record_audit(
            db,
            actor_id=None,
            action="login",
            entity="auth",
            diff={
                "provider": "password",
                "success": False,
                "reason": "rate_limited",
                "email": email,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(f"Terlalu banyak percobaan masuk. Coba lagi dalam {minutes} menit."),
        )

    user = (await db.scalars(select(User).where(User.email == email))).first()

    if user is None or not verify_password(payload.password, user.password_hash):
        await rate_limit.register_login_failure(redis, email, ip)
        await record_audit(
            db,
            actor_id=user.id if user else None,
            action="login",
            entity="auth",
            diff={"provider": "password", "success": False, "email": email},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email atau kata sandi salah.",
        )
    if not user.is_active:
        await record_audit(
            db,
            actor_id=user.id,
            action="login",
            entity="auth",
            diff={"provider": "password", "success": False, "reason": "akun_nonaktif"},
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Akun dinonaktifkan.")

    await rate_limit.reset_login_failures(redis, email, ip)
    await record_audit(
        db,
        actor_id=user.id,
        action="login",
        entity="auth",
        entity_id=user.id,
        diff={"provider": "password", "success": True},
    )
    return _issue_tokens(user, remember=payload.remember)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    settings = get_settings()
    payload_data = decode_refresh_token(payload.refresh_token)
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sesi tidak valid. Silakan masuk kembali.",
    )
    if payload_data is None or "sub" not in payload_data:
        raise unauthorized
    try:
        user = await db.get(User, uuid.UUID(payload_data["sub"]))
    except ValueError:
        raise unauthorized from None
    if user is None or not user.is_active:
        raise unauthorized

    remember = bool(payload_data.get("rem", True))
    days = (
        settings.refresh_token_expire_days if remember else settings.refresh_token_expire_days_short
    )
    refresh_token = create_refresh_token(user.id, days, remember=remember)
    return TokenResponse(
        access_token=create_access_token(user.id, user.role),
        refresh_token=refresh_token,
        user=UserPublic.model_validate(user),
    )


@router.post("/google", response_model=TokenResponse)
async def google_signin(
    payload: GoogleAuthRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    try:
        info = await google_service.verify_google_id_token(payload.id_token)
    except google_service.GoogleAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None

    user = (await db.scalars(select(User).where(User.google_sub == info["sub"]))).first()
    if user is None:
        # Tautkan akun email+password yang sudah ada bila email Google terverifikasi.
        user = (await db.scalars(select(User).where(User.email == info["email"]))).first()
        if user is not None:
            user.google_sub = info["sub"]
            if user.avatar_url is None and info["picture"]:
                user.avatar_url = info["picture"]
            await db.commit()
            await db.refresh(user)
        else:
            user = User(
                email=info["email"],
                full_name=info["name"][:100],
                avatar_url=info["picture"],
                google_sub=info["sub"],
                role="user",
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Akun dinonaktifkan.")

    await record_audit(
        db,
        actor_id=user.id,
        action="login",
        entity="auth",
        entity_id=user.id,
        diff={"provider": "google", "success": True},
    )
    return _issue_tokens(user, remember=True)


@router.get("/me", response_model=UserPublic)
async def me(user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic.model_validate(user)
