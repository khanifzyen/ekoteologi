"""Logika bisnis misi (Sprint 4–5): periode klaim, anti dobel, dan progres
auto_scan — PRD §2.3/§5.4.

Anti dobel klaim bertumpu pada constraint DB `UNIQUE(user_id, mission_id,
period_date)` (sudah ada sejak skema awal). Kunci periode dihitung server-side
agar klien tidak bisa memilih periodenya sendiri:

- `daily`   → tanggal hari ini;
- `weekly`  → hari Senin minggu berjalan (satu klaim per minggu);
- `special` → tanggal hari ini (fallback aman — tetap anti dobel harian;
  misi spesial MVP selalu berjendek pendek).

`period_date` TIDAK pernah NULL untuk klaim: di PostgreSQL NULL dianggap
berbeda satu sama lain oleh UNIQUE sehingga baris period kosong bisa lolos —
karena itu setiap klaim wajib membawa tanggal periode.

Sprint 5: `apply_scan_progress()` menaikkan `progress_count` misi auto_scan
setiap scan bernilai poin; saat target `required_count` tercapai, misi
di-approve otomatis — poin lewat ledger, notifikasi in-app, dan event
`misi_selesai` (PRD §8) dalam transaksi yang sama dgn scan.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Mission, User, UserMission
from app.services.ledger import award_points
from app.services.metrics import EVENT_MISI_SELESAI, track_event
from app.services.notifications import notify

# Nilai sah kolom `missions.type` / `missions.verification` (PRD §5.4).
MISSION_TYPES = ("daily", "weekly", "special")
VERIFICATION_MODES = ("photo", "auto_scan", "manual")

logger = logging.getLogger("ekoteologi.missions")


@dataclass(frozen=True)
class AutoScanCompletion:
    """Misi auto_scan yang tuntas karena satu scan (utk log & respons)."""

    claim_id: int
    mission_id: int
    mission_title: str
    points: int


def period_date_for(mission: Mission, today: date | None = None) -> date:
    """Tanggal periode klaim utk misi — dasar constraint anti dobel."""
    day = today or date.today()
    if mission.type == "weekly":
        # Senin minggu berjalan (weekday: Sen=0 … Min=6).
        return day - timedelta(days=day.weekday())
    return day


def is_within_period(mission: Mission, now=None) -> bool:
    """Misi tampil/klaim hanya di dalam jendela `start_at`–`end_at` (bila diisi)."""
    moment = now
    if moment is None:
        from datetime import datetime

        moment = datetime.now().astimezone()
    if mission.start_at is not None and moment < mission.start_at:
        return False
    if mission.end_at is not None and moment > mission.end_at:
        return False
    return True


async def _get_claim(
    db: AsyncSession, user_id: uuid.UUID, mission_id: int, period: date
) -> UserMission | None:
    return (
        await db.scalars(
            select(UserMission).where(
                UserMission.user_id == user_id,
                UserMission.mission_id == mission_id,
                UserMission.period_date == period,
            )
        )
    ).first()


async def _get_or_create_progress_claim(
    db: AsyncSession, user: User, mission: Mission, period: date
) -> UserMission:
    """Baris progres `in_progress` utk misi auto_scan (get-or-create anti race).

    Dua scan serentak bisa sama-sama melihat "belum ada baris"; SAVEPOINT +
    penanganan `IntegrityError` menjaga constraint UNIQUE tetap penentu —
    pihak yang kalah mengambil ulang baris pemenangnya.
    """
    claim: UserMission | None = None
    try:
        async with db.begin_nested():
            claim = await _get_claim(db, user.id, mission.id, period)
            if claim is None:
                claim = UserMission(
                    user_id=user.id,
                    mission_id=mission.id,
                    period_date=period,
                    status="in_progress",
                    progress_count=0,
                )
                db.add(claim)
                await db.flush()
    except IntegrityError:
        # SAVEPOINT sudah di-rollback oleh begin_nested — ambil baris pemenang.
        claim = None
    refreshed = await _get_claim(db, user.id, mission.id, period)
    return refreshed or claim


async def apply_scan_progress(
    db: AsyncSession,
    *,
    user: User,
    category_id: int,
    now: datetime | None = None,
) -> list[AutoScanCompletion]:
    """Naikkan progres seluruh misi auto_scan aktif yang relevan dgn satu scan.

    Aturan hitung (keputusan kerja Sprint 5):
    - hanya scan BERNILAI POIN (>0, bukan duplikat) yang dihitung — anti
      poin-farming via foto sama berulang (PRD §9);
    - misi dgn `scan_category_id` diisi hanya maju oleh kategori itu; yang
      kosong maju oleh scan apa pun ("Scan 3 jenis sampah berbeda");
    - progres disimpan pada periode berjalan (daily/weekly, pola klaim).

    Dipanggil dari `POST /v1/scan` sebelum commit — poin misi, bonus streak,
    notifikasi, dan event konsisten satu transaksi.
    """
    moment = now or datetime.now().astimezone()
    today = moment.date()
    missions = (
        await db.scalars(
            select(Mission).where(
                Mission.verification == "auto_scan",
                Mission.is_active.is_(True),
                (Mission.start_at.is_(None)) | (Mission.start_at <= moment),
                (Mission.end_at.is_(None)) | (Mission.end_at >= moment),
            )
        )
    ).all()

    completions: list[AutoScanCompletion] = []
    for mission in missions:
        if mission.scan_category_id is not None and mission.scan_category_id != category_id:
            continue
        period = period_date_for(mission, today)
        claim = await _get_claim(db, user.id, mission.id, period)
        if claim is not None and claim.status != "in_progress":
            # approved/pending/rejected: tidak dihitung ulang — klaim rejected
            # auto_scan tidak mungkin lewat alur ini, approved sudah berpoin.
            continue
        if claim is None:
            claim = await _get_or_create_progress_claim(db, user, mission, period)
        if claim.status != "in_progress":
            continue

        claim.progress_count += 1
        if claim.progress_count < max(1, mission.required_count):
            continue

        # Target tercapai → selesai otomatis: poin via ledger (Sprint 4:
        # poin misi hanya lewat approval), notifikasi, dan event PRD §8.
        claim.status = "approved"
        claim.points_awarded = mission.points
        claim.reviewed_at = moment
        await award_points(
            db,
            user=user,
            amount=mission.points,
            source="mission",
            ref_id=claim.id,
            note=f"Misi auto_scan: {mission.title}",
        )
        notify(
            db,
            user_id=user.id,
            title="Misi selesai otomatis!",
            body=f'"{mission.title}" tercapai dari scanmu — +{mission.points} poin masuk.',
            type_="mission",
            payload={"claim_id": claim.id, "mission_id": mission.id, "status": "approved"},
        )
        await track_event(
            db,
            user_id=user.id,
            name=EVENT_MISI_SELESAI,
            payload={"mission_id": mission.id, "points": mission.points, "claim_id": claim.id},
        )
        completions.append(
            AutoScanCompletion(
                claim_id=claim.id,
                mission_id=mission.id,
                mission_title=mission.title,
                points=mission.points,
            )
        )
        logger.info(
            "MISSION AUTO_SCAN selesai id=%s user=%s mission=%s points=%d",
            claim.id,
            user.id,
            mission.id,
            mission.points,
        )
    return completions
