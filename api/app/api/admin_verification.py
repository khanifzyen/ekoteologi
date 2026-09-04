"""Admin: verifikasi klaim misi (Sprint 5) — layar `verifikasi.html`.

`POST /v1/admin/claims/{id}/review` menutup loop misi: klaim `pending` →
`approved` (poin lewat ledger, notifikasi in-app, event `misi_selesai`,
streak berdetak) atau `rejected` (catatan wajib — AUDIT.md A2). Keputusan
tercatat di audit log via middleware (Sprint 0). Daftar antrian tetap di
`GET /v1/admin/claims` (`admin_missions.py`).
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, require_roles
from app.models import Mission, User, UserMission
from app.schemas.mission import (
    ClaimAdminOut,
    ClaimMissionBrief,
    ClaimReviewRequest,
    ClaimUserBrief,
)
from app.services.badges import sync_user_badges
from app.services.ledger import award_points
from app.services.metrics import EVENT_MISI_SELESAI, track_event
from app.services.notifications import notify
from app.services.push import push_notification
from app.services.streak import touch_streak

logger = logging.getLogger("ekoteologi.verification")

router = APIRouter(prefix="/v1/admin", tags=["admin"])


async def _claim_admin_out(db: AsyncSession, claim: UserMission) -> ClaimAdminOut:
    """Bentuk respons klaim + konteks user/mission + rekap klaim pengguna."""
    claim_user = await db.get(User, claim.user_id)
    mission = await db.get(Mission, claim.mission_id)
    user_claims_total = int(
        await db.scalar(
            select(func.count())
            .select_from(UserMission)
            .where(UserMission.user_id == claim.user_id)
        )
        or 0
    )

    return ClaimAdminOut(
        id=claim.id,
        status=claim.status,
        period_date=claim.period_date,
        progress_count=claim.progress_count,
        points_awarded=claim.points_awarded,
        proof_image_url=claim.proof_image_url,
        note=claim.note,
        review_note=claim.review_note,
        consent_at=claim.consent_at,
        submitted_at=claim.submitted_at,
        reviewed_at=claim.reviewed_at,
        user=ClaimUserBrief(
            id=str(claim_user.id), full_name=claim_user.full_name, city=claim_user.city
        )
        if claim_user
        else ClaimUserBrief(id="", full_name="?", city=None),
        mission=ClaimMissionBrief(
            id=mission.id,
            title=mission.title,
            points=mission.points,
            verification=mission.verification,
        )
        if mission
        else ClaimMissionBrief(id=0, title="?", points=0, verification="photo"),
        user_claims_total=user_claims_total,
    )


@router.post("/claims/{claim_id}/review", response_model=ClaimAdminOut)
async def review_claim(
    claim_id: int,
    payload: ClaimReviewRequest,
    reviewer: User = Depends(require_roles("admin", "verifier")),
    db: AsyncSession = Depends(get_db),
) -> ClaimAdminOut:
    """Setujui/tolak klaim `pending` — catatan wajib saat menolak.

    Approve: poin misi masuk via ledger (`source="mission"`), `users.points`
    tersinkron, notifikasi in-app terkirim, event `streak_hari`/`misi_selesai`
    (PRD §8) tercatat, streak user ikut berdetak — semuanya satu transaksi.
    """
    if payload.decision not in ("approved", "rejected"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Keputusan harus 'approved' atau 'rejected'.",
        )

    claim = await db.get(UserMission, claim_id)
    if claim is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Klaim tidak ditemukan.")
    if claim.status != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Klaim ini sudah direview sebelumnya — muat ulang antrian.",
        )
    mission = await db.get(Mission, claim.mission_id)
    if mission is None:  # misi dihapus — seharusnya terblokir oleh proteksi DELETE
        raise HTTPException(status.HTTP_409_CONFLICT, "Misi klaim ini sudah tidak ada.")

    note = payload.note.strip() if payload.note else ""
    now = datetime.now().astimezone()
    push_source = None

    if payload.decision == "rejected":
        if not note:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Catatan wajib diisi saat menolak — agar user tahu apa yang perlu diperbaiki.",
            )
        claim.status = "rejected"
        claim.review_note = note
        claim.reviewed_by = reviewer.id
        claim.reviewed_at = now
        push_source = notify(
            db,
            user_id=claim.user_id,
            title="Misi perlu diperbaiki",
            body=f'"{mission.title}" ditolak — {note} Kamu bisa unggah ulang bukti di layar Misi.',
            type_="mission",
            payload={"claim_id": claim.id, "mission_id": mission.id, "status": "rejected"},
        )
        outcome = "rejected"
    else:
        claim_user = await db.get(User, claim.user_id)
        if claim_user is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Pengguna klaim tidak ditemukan.")
        claim.status = "approved"
        claim.points_awarded = mission.points
        claim.reviewed_by = reviewer.id
        claim.reviewed_at = now
        if note:
            claim.review_note = note
        await award_points(
            db,
            user=claim_user,
            amount=mission.points,
            source="mission",
            ref_id=claim.id,
            note=f"Misi: {mission.title}",
        )
        push_source = notify(
            db,
            user_id=claim.user_id,
            title="Misi disetujui!",
            body=f'"{mission.title}" diverifikasi — +{mission.points} poin masuk ke akunmu.',
            type_="mission",
            payload={
                "claim_id": claim.id,
                "mission_id": mission.id,
                "status": "approved",
                "points": mission.points,
            },
        )
        await track_event(
            db,
            user_id=claim.user_id,
            name=EVENT_MISI_SELESAI,
            payload={"mission_id": mission.id, "points": mission.points, "claim_id": claim.id},
        )
        # Menyetujui misi = aktivitas user hari ini (idempoten per hari).
        await touch_streak(db, user=claim_user, now=now)
        # Badge engine (Sprint 6): lencana on-event — misi pertama dkk.
        # diraih + dinotifikasikan dalam transaksi yang sama (idempoten).
        for badge in await sync_user_badges(db, user=claim_user):
            logger.info("BADGE %s earned oleh user=%s (approve misi)", badge.code, claim_user.id)
        outcome = "approved"

    await db.commit()
    await db.refresh(claim)
    # Push FCM (Sprint 6) — notifikasi in-app adalah sumber push: dikirim best-
    # effort SETELAH commit (gagal push tidak pernah menggagalkan verifikasi).
    # Mode default "log" — pengiriman nyata menunggu kredensial server.
    if push_source is not None:
        sent = await push_notification(db, push_source)
        if sent:
            logger.info("PUSH terkirim x%d utk notifikasi klaim=%s", sent, claim.id)
    logger.info(
        "VERIFIKASI %s claim=%s mission=%s reviewer=%s user=%s points=%d",
        outcome.upper(),
        claim.id,
        mission.id,
        reviewer.id,
        claim.user_id,
        claim.points_awarded,
    )
    return await _claim_admin_out(db, claim)
