"""Skema profil user (Sprint 1)."""

from pydantic import BaseModel, Field


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    avatar_url: str | None = Field(default=None, max_length=500)


class ProfileResponse(BaseModel):
    """Profil + level terhitung dari tabel levels (PRD §5.10 #2: level tidak disimpan).

    Sprint 5: tambahan info level berikutnya utk UI (sisa poin & progres).
    Sprint 6: statistik dampak — bahan kartu "Pohon Kebaikanmu" `beranda.html`
    & statistik layar profil (`scans_total` hanya scan bernilai poin).
    """

    id: str
    email: str | None
    full_name: str
    role: str
    avatar_url: str | None
    city: str | None
    points: int
    level: int
    level_title: str
    next_level: int | None = None
    next_level_title: str | None = None
    next_level_points: int | None = None  # poin minimal level berikutnya
    current_streak: int = 0
    longest_streak: int = 0
    level_progress: int | None = None  # % di level berjalan (None = puncak)
    scans_total: int = 0  # scan bernilai poin (anti farming — konsisten badge engine)
    missions_approved: int = 0  # klaim misi approved
    badges_earned: int = 0  # lencana diraih
