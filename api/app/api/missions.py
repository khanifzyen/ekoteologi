"""Misi untuk user mobile (Sprint 4–5) — `misi.html`.

- `GET  /v1/missions`              — daftar misi aktif + status klaim saya
                                     periode berjalan + ringkasan mingguan.
- `POST /v1/missions/{id}/claim`   — klaim misi `photo` (bukti → antrian
                                     `pending`) dan `manual` (auto-approve:
                                     poin langsung lewat ledger). Progres
                                     `auto_scan` dihitung dari scan (lihat
                                     `services.missions.apply_scan_progress`).
- `GET  /v1/badges`                — lencana utk tab Pencapaian (earned flag).

Anti dobel klaim: constraint `UNIQUE(user_id, mission_id, period_date)` +
periode dihitung server (`services.missions.period_date_for`). Bukti photo
yang DITOLAK boleh diganti — baris yang sama di-reset (lihat catatan di claim).
Poin misi SELALU lewat `award_points()` ledger saat approval (Sprint 4/5):
klaim photo tidak menyentuh poin; klaim manual = approval saat klaim.
"""

import logging
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user, get_db
from app.models import Badge, Mission, User, UserBadge, UserMission
from app.schemas.mission import (
    BadgeOut,
    ClaimOut,
    ClaimResponse,
    MissionOut,
    MissionsPage,
    WeekSummary,
)
from app.services import missions as mission_service
from app.services.ledger import award_points
from app.services.metrics import EVENT_MISI_SELESAI, track_event
from app.services.notifications import notify
from app.services.streak import touch_streak

logger = logging.getLogger("ekoteologi.missions")

router = APIRouter(prefix="/v1", tags=["missions"])

# Magic bytes foto bukti (pola avatar/scan — header klien tidak dipercaya).
_IMAGE_SIGNATURES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
}
_WEBP = ("image/webp", "webp")


def _detect_mime(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return _WEBP[0]
    return None


def _save_proof(data: bytes, mime: str) -> str:
    """Simpan bukti ke UPLOAD_DIR/missions; kembalikan URL `/uploads/missions/…`.

    Direktori ini berisi foto yang bisa memuat wajah (PRD §9) — hanya ditampilkan
    ke verifier/admin di layar verifikasi (Sprint 5), tidak pernah ke user lain.
    """
    ext = _IMAGE_SIGNATURES.get(mime) or (_WEBP[1] if mime == _WEBP[0] else "bin")
    proof_dir = Path(get_settings().upload_dir) / "missions"
    proof_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    (proof_dir / filename).write_bytes(data)
    return f"/uploads/missions/{filename}"


def _delete_proof(proof_url: str | None) -> None:
    """Hapus berkas bukti lama saat diganti (privasi — PRD §9)."""
    if not proof_url or not proof_url.startswith("/uploads/missions/"):
        return
    path = Path(get_settings().upload_dir) / "missions" / Path(proof_url).name
    path.unlink(missing_ok=True)


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


def _week_bounds(today: date) -> tuple[date, date]:
    monday = today - timedelta(days=today.weekday())
    return monday, monday + timedelta(days=6)


def _claim_out(claim: UserMission) -> ClaimOut:
    return ClaimOut(
        id=claim.id,
        status=claim.status,
        progress_count=claim.progress_count,
        points_awarded=claim.points_awarded,
        review_note=claim.review_note,
        submitted_at=claim.submitted_at,
    )


@router.post("/missions/{mission_id}/claim", response_model=ClaimResponse, status_code=201)
async def claim_mission(
    mission_id: int,
    consent: bool = Form(default=False),
    file: UploadFile | None = File(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClaimResponse:
    """Klaim misi photo (bukti → antrian) atau manual (auto-approve + poin).

    - `photo`: consent wajib (PRD §9, keputusan §2.1 #6) + foto bukti —
      masuk antrian `pending`, poin baru saat verifier menyetujui.
    - `manual`: auto-approve saat klaim ("Klaim Poin") — poin lewat ledger,
      event `misi_selesai`, dan streak ikut berdetak dalam satu transaksi.
    - `auto_scan`: tidak diklaim manual — progres dihitung dari scan.
    """
    mission = await db.get(Mission, mission_id)
    if mission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Misi tidak ditemukan.")
    if not mission.is_active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Misi ini sudah tidak aktif.")
    if not mission_service.is_within_period(mission):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Misi ini belum dibuka atau sudah melewati periodenya.",
        )

    now = datetime.now().astimezone()
    today = now.date()

    # ── Mode auto_scan: progres dari scan, bukan klaim manual (Sprint 5). ──
    if mission.verification == "auto_scan":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Progres misi ini dihitung otomatis dari scan — buka layar Scan untuk mengerjakannya.",
        )

    if mission.verification == "photo":
        return await _claim_photo(
            db, user=user, mission=mission, consent=consent, file=file, now=now, today=today
        )
    return await _claim_manual(db, user=user, mission=mission, now=now, today=today)


async def _claim_photo(
    db: AsyncSession,
    *,
    user: User,
    mission: Mission,
    consent: bool,
    file: UploadFile | None,
    now: datetime,
    today: date,
) -> ClaimResponse:
    """Klaim photo (Sprint 4): consent + bukti → antrian `pending`."""
    if not consent:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Persetujuan penggunaan foto wajib diberikan sebelum mengunggah bukti.",
        )
    if file is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Foto bukti wajib diunggah.")

    settings = get_settings()
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Foto bukti kosong.")
    max_bytes = settings.mission_image_max_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"Ukuran foto maksimal {settings.mission_image_max_mb} MB.",
        )
    mime = _detect_mime(data)
    if mime is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Format foto harus JPG, PNG, atau WebP.")

    period = mission_service.period_date_for(mission, today)
    existing = await _get_claim(db, user.id, mission.id, period)

    if existing is not None and existing.status in ("pending", "approved", "in_progress"):
        if existing.status == "approved":
            message = "Misi ini sudah selesai untuk periode ini."
        else:
            message = "Kamu sudah mengklaim misi ini — menunggu verifikasi admin."
        raise HTTPException(status.HTTP_409_CONFLICT, message)

    # Bukti pernah DITOLAK → baris sama dipakai ulang (constraint anti dobel tetap
    # terjaga): bukti lama dihapus dari disk, status kembali `pending`.
    resubmission = existing is not None
    if resubmission:
        _delete_proof(existing.proof_image_url)
        existing.proof_image_url = _save_proof(data, mime)
        existing.status = "pending"
        existing.consent_at = now
        existing.submitted_at = now
        existing.reviewed_by = None
        existing.reviewed_at = None
        existing.review_note = None
        existing.points_awarded = 0
        claim = existing
    else:
        claim = UserMission(
            user_id=user.id,
            mission_id=mission.id,
            period_date=period,
            status="pending",
            proof_image_url=_save_proof(data, mime),
            consent_at=now,
            submitted_at=now,
        )
        db.add(claim)

    try:
        await db.commit()
    except IntegrityError:
        # Balapan dua klaim serentak: constraint UNIQUE mencegah dobel.
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Kamu sudah mengklaim misi ini — menunggu verifikasi admin.",
        ) from None
    await db.refresh(claim)

    logger.info(
        "MISSION CLAIM id=%s user=%s mission=%s period=%s resubmit=%s",
        claim.id,
        user.id,
        mission.id,
        period,
        resubmission,
    )
    return ClaimResponse(
        claim=_claim_out(claim),
        message="Bukti terkirim — menunggu verifikasi admin (maks. 1×24 jam).",
    )


async def _claim_manual(
    db: AsyncSession,
    *,
    user: User,
    mission: Mission,
    now: datetime,
    today: date,
) -> ClaimResponse:
    """Klaim manual (Sprint 5): auto-approve — poin langsung lewat ledger.

    Tanpa consent/foto (tidak ada unggahan); approved oleh sistem
    (`reviewed_by` NULL, `reviewed_at` terisi). Anti dobel & periode sama
    dengan klaim photo; streak + event `misi_selesai` ikut transaksi.
    """
    period = mission_service.period_date_for(mission, today)
    existing = await _get_claim(db, user.id, mission.id, period)
    if existing is not None and existing.status in ("pending", "approved", "in_progress"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Misi ini sudah diklaim untuk periode ini."
            if existing.status == "approved"
            else "Kamu sudah mengklaim misi ini — menunggu verifikasi admin.",
        )

    if existing is not None:  # rejected (kasus jarang) — baris sama dipakai ulang
        claim = existing
        claim.status = "approved"
        claim.points_awarded = mission.points
        claim.reviewed_at = now
        claim.review_note = None
    else:
        claim = UserMission(
            user_id=user.id,
            mission_id=mission.id,
            period_date=period,
            status="approved",
            points_awarded=mission.points,
            reviewed_at=now,
        )
        db.add(claim)

    await db.flush()  # dapatkan claim.id utk ref_id ledger
    await award_points(
        db,
        user=user,
        amount=mission.points,
        source="mission",
        ref_id=claim.id,
        note=f"Misi manual: {mission.title}",
    )
    notify(
        db,
        user_id=user.id,
        title="Poin misi masuk",
        body=f'"{mission.title}" diklaim — +{mission.points} poin masuk ke akunmu.',
        type_="mission",
        payload={"claim_id": claim.id, "mission_id": mission.id, "status": "approved"},
    )
    await track_event(
        db,
        user_id=user.id,
        name=EVENT_MISI_SELESAI,
        payload={"mission_id": mission.id, "points": mission.points, "claim_id": claim.id},
    )
    await touch_streak(db, user=user, now=now)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Kamu sudah mengklaim misi ini untuk periode ini.",
        ) from None
    await db.refresh(claim)

    logger.info(
        "MISSION CLAIM MANUAL id=%s user=%s mission=%s points=%d period=%s",
        claim.id,
        user.id,
        mission.id,
        mission.points,
        period,
    )
    return ClaimResponse(
        claim=_claim_out(claim),
        message=f"Misi diklaim! +{mission.points} poin langsung masuk ke akunmu.",
    )


@router.get("/missions", response_model=MissionsPage)
async def list_missions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MissionsPage:
    """Daftar misi aktif di dalam jendela periode + klaim saya + ringkasan mingguan."""
    now = datetime.now().astimezone()
    today = now.date()
    rows = (
        await db.scalars(
            select(Mission)
            .where(
                Mission.is_active.is_(True),
                (Mission.start_at.is_(None)) | (Mission.start_at <= now),
                (Mission.end_at.is_(None)) | (Mission.end_at >= now),
            )
            .order_by(Mission.id.asc())
        )
    ).all()

    items: list[MissionOut] = []
    for mission in rows:
        period = mission_service.period_date_for(mission, today)
        claim = await _get_claim(db, user.id, mission.id, period)
        items.append(
            MissionOut(
                id=mission.id,
                title=mission.title,
                description=mission.description,
                type=mission.type,
                icon=mission.icon,
                points=mission.points,
                verification=mission.verification,
                required_count=mission.required_count,
                start_at=mission.start_at,
                end_at=mission.end_at,
                my_claim=(
                    ClaimOut(
                        id=claim.id,
                        status=claim.status,
                        progress_count=claim.progress_count,
                        points_awarded=claim.points_awarded,
                        review_note=claim.review_note,
                        submitted_at=claim.submitted_at,
                    )
                    if claim
                    else None
                ),
            )
        )

    monday, sunday = _week_bounds(today)
    week_row = await db.execute(
        select(func.count(), func.coalesce(func.sum(UserMission.points_awarded), 0)).where(
            UserMission.user_id == user.id,
            UserMission.status == "approved",
            UserMission.period_date >= monday,
            UserMission.period_date <= sunday,
        )
    )
    week_done, week_points = week_row.one()
    return MissionsPage(
        items=items,
        summary=WeekSummary(
            week_done=int(week_done or 0),
            week_total=len(items),
            week_points=int(week_points or 0),
        ),
    )


@router.get("/badges", response_model=list[BadgeOut])
async def list_badges(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BadgeOut]:
    """Lencana tab Pencapaian — kriteria dievaluasi badge engine (Sprint 6).

    Sprint 4 data yang tampil jujur: lencana seed + yang sudah diraih
    (`user_badges`) — saat ini belum ada mekanisme pemberian otomatis.
    """
    rows = (
        await db.execute(
            select(Badge, UserBadge.earned_at)
            .join(
                UserBadge,
                (UserBadge.badge_id == Badge.id) & (UserBadge.user_id == user.id),
                isouter=True,
            )
            .order_by(Badge.id.asc())
        )
    ).all()
    return [
        BadgeOut(
            id=badge.id,
            code=badge.code,
            name=badge.name,
            icon=badge.icon,
            description=badge.description,
            earned=earned_at is not None,
            earned_at=earned_at,
        )
        for badge, earned_at in rows
    ]
