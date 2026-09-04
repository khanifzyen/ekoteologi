"""Schema admin: daftar pengguna (Sprint 4, `admin/pengguna.html`)."""

from datetime import datetime

from pydantic import BaseModel


class AdminUserOut(BaseModel):
    id: str
    full_name: str
    email: str | None = None
    city: str | None = None
    points: int
    role: str  # user|verifier|editor|admin
    is_active: bool
    level: int
    level_title: str
    created_at: datetime


class UsersPage(BaseModel):
    items: list[AdminUserOut]
    total: int
    limit: int
    offset: int
