"""Skema profil user (Sprint 1)."""

from pydantic import BaseModel, Field


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    avatar_url: str | None = Field(default=None, max_length=500)


class ProfileResponse(BaseModel):
    """Profil + level terhitung dari tabel levels (PRD §5.10 #2: level tidak disimpan)."""

    id: str
    email: str | None
    full_name: str
    role: str
    avatar_url: str | None
    city: str | None
    points: int
    level: int
    level_title: str
