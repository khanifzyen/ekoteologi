"""Instrumentasi metrik produk (Sprint 3) — PRD §8 / implementation-plan §5.3.

Event wajib sejak Sprint 3: `scan_pertama` (aktivasi). Sprint 5 menambah
`misi_selesai` (klaim disetujui / misi manual / auto_scan tuntas) dan
`streak_hari` (hari aktif baru). `modul_selesai` menyusul di Sprint 7 lewat
fungsi yang sama — satu tabel `analytics_events` append-only (hanya INSERT,
tidak pernah UPDATE/DELETE) agar angka aktivasi bisa diaudit.
"""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AnalyticsEvent

# Nama event yang sah — menjaga konsistensi nama antar sprint (PRD §8).
EVENT_SCAN_PERTAMA = "scan_pertama"
EVENT_MISI_SELESAI = "misi_selesai"
EVENT_STREAK_HARI = "streak_hari"
KNOWN_EVENTS = {EVENT_SCAN_PERTAMA, EVENT_MISI_SELESAI, EVENT_STREAK_HARI}


async def track_event(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    name: str,
    payload: dict[str, Any] | None = None,
) -> None:
    """Catat satu event metrik.

    Tidak melakukan commit — event ikut transaksi pemanggil (mis. transaksi
    scan yang sama dgn ledger poin) agar tidak ada event "hantu" saat request
    gagal di tengah jalan.
    """
    db.add(AnalyticsEvent(user_id=user_id, name=name, payload=payload))
    await db.flush()
