"""Schema scan (Sprint 2): kontrak respons LLM + respons endpoint — PRD §2.2/§5.3.

`ScanLLMResult` divalidasi ketat (Pydantic) sebelum dipakai — hasil LLM yang tidak
lolos schema memicu retry/fallback, tidak pernah sampai ke DB.
"""

from datetime import datetime

from pydantic import BaseModel, Field


class Quote(BaseModel):
    """Kutipan ayat/hadis — selalu diisi dari bank terkurasi (anti-halusinasi, PRD §9)."""

    text: str
    source: str


class ScanLLMResult(BaseModel):
    """Hasil analisis LLM — `{item_name, category, advice, quote, points}` (PRD §2.2)."""

    item_name: str = Field(min_length=2, max_length=100)
    category: str = Field(min_length=2, max_length=50)
    advice: str = Field(min_length=5, max_length=1000)
    quote: Quote | None = None  # saran LLM; server selalu mengganti dgn bank quote
    points: int = Field(ge=0, le=100)


class ScanCategoryOut(BaseModel):
    id: int
    name: str
    icon: str | None = None


class ScanCategoryFullOut(ScanCategoryOut):
    """Kategori lengkap — daftar filter riwayat + info poin dasar."""

    base_points: int


class ScanHistoryItem(BaseModel):
    """Satu baris riwayat scan (layar Riwayat mobile, Sprint 3)."""

    id: int
    item_name: str | None = None
    category: ScanCategoryOut | None = None
    points: int
    image_url: str | None = None
    created_at: datetime


class ScanHistoryPage(BaseModel):
    """Respons `GET /v1/scans` — offset pagination + total utk tombol "Muat lagi"."""

    items: list[ScanHistoryItem]
    total: int
    limit: int
    offset: int


class ScanQuotaOut(BaseModel):
    """Respons `GET /v1/scans/quota` — batas harian utk UI scan (PRD §8 budget)."""

    used: int
    limit: int
    remaining: int
    resets_in_seconds: int


class ScanResponse(BaseModel):
    """Respons `POST /v1/scan` — sheet hasil di mobile (Sprint 3) mengonsumsi ini."""

    id: int
    item_name: str
    category: ScanCategoryOut
    advice: str
    quote: Quote
    points: int
    points_total: int  # total poin user setelah scan ini (cache ledger)
    cached: bool  # hasil dari cache Redis (bukan panggilan LLM baru)
    duplicate: bool  # foto sama dari user sama di hari sama → poin 0 (anti poin-farming)
    image_url: str | None = None
    created_at: datetime
