"""Auth dasar Sprint 0: login email+password untuk admin panel.

Catatan scope: refresh token, rate limit, Google Sign-In adalah Story Sprint 1 —
endpoint ini sengaja minimal agar admin punya login & role guard nyata.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.core.security import create_access_token, verify_password
from app.models import User
from app.schemas.auth import LoginRequest, TokenResponse, UserPublic
from app.services.audit import record_audit

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user = (await db.scalars(select(User).where(User.email == payload.email.lower()))).first()

    if user is None or not verify_password(payload.password, user.password_hash):
        await record_audit(
            db,
            actor_id=None,
            action="login",
            entity="auth",
            diff={"provider": "password", "success": False, "email": payload.email.lower()},
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

    await record_audit(
        db,
        actor_id=user.id,
        action="login",
        entity="auth",
        entity_id=user.id,
        diff={"provider": "password", "success": True},
    )
    return TokenResponse(
        access_token=create_access_token(user.id, user.role),
        user=UserPublic.model_validate(user),
    )


@router.get("/me", response_model=UserPublic)
async def me(user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic.model_validate(user)
