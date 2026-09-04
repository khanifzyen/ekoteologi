"""Skema konten harian (Sprint 6) — tabel `daily_contents` PRD §5.6.

Dua bentuk respons:
- `ContentOut` (admin CRUD) — baris apa adanya + status jadwal.
- `DailyContentOut` (mobile) — konten hari ini + flag `fallback` (bila tidak
  ada konten terjadwal, API menggugurkan ke bank quote terkurasi Sprint 2 —
  satu sumber kebenaran kutipan, keputusan terdokumentasi di laporan sprint).
"""

from datetime import date

from pydantic import BaseModel, Field

CONTENT_TYPES = ("ayat", "hadis", "refleksi")


class ContentBase(BaseModel):
    type: str  # ayat|hadis|refleksi
    title: str | None = Field(default=None, max_length=200)
    body: str = Field(min_length=1, max_length=5000)
    source: str | None = Field(default=None, max_length=100)
    eco_action: str | None = Field(default=None, max_length=500)
    image_url: str | None = Field(default=None, max_length=1000)


class ContentCreate(ContentBase):
    publish_date: date  # jadwal tayang (UNIQUE — satu konten per hari)


class ContentUpdate(BaseModel):
    publish_date: date | None = None
    type: str | None = None
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, min_length=1, max_length=5000)
    source: str | None = Field(default=None, max_length=100)
    eco_action: str | None = Field(default=None, max_length=500)
    image_url: str | None = Field(default=None, max_length=1000)


class ContentOut(BaseModel):
    id: int
    publish_date: date
    type: str
    title: str | None = None
    body: str
    source: str | None = None
    eco_action: str | None = None
    image_url: str | None = None
    is_published: bool  # publish_date <= hari ini (sudah/sedang tayang)


class DailyContentOut(BaseModel):
    """Kartu "Kutipan Hari Ini" `beranda.html` — konten terjadwal atau fallback."""

    date: date
    type: str  # ayat|hadis|refleksi|fallback
    title: str | None = None
    body: str  # kutipan utama (kartu wisdom)
    source: str | None = None
    eco_action: str | None = None  # "Aksi hari ini" — None saat fallback
    fallback: bool = False  # true = bank quote (tidak ada konten terjadwal)
