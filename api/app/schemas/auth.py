"""Skema request/response API (Pydantic)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None
    full_name: str
    role: str
    avatar_url: str | None
    city: str | None
    points: int


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class AuditLogPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_id: uuid.UUID | None
    action: str | None
    entity: str | None
    entity_id: str | None
    diff: dict | None
    created_at: datetime


class AuditLogPage(BaseModel):
    items: list[AuditLogPublic]
    limit: int
    offset: int
