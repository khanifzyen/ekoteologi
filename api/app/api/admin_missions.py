"""Admin: CRUD misi + antrian klaim (Sprint 4).

- `GET    /v1/admin/missions`        — daftar misi + rekap klaim (panel roles).
- `POST   /v1/admin/missions`        — buat misi (admin|editor).
- `PATCH  /v1/admin/missions/{id}`   — ubah misi, termasuk aktif/nonaktif.
- `DELETE /v1/admin/missions/{id}`   — hapus (admin); ditolak bila sudah ada klaim.
- `GET    /v1/admin/claims`          — baris `user_missions` (antrian verifikasi —
  aksi approve/reject menyusul Sprint 5; modul ini menyediakan datanya).

Semua tulisan tercatat audit log via middleware (Sprint 0).
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, require_roles
from app.models import Mission, User, UserMission, WasteCategory
from app.schemas.mission import (
    ClaimAdminOut,
    ClaimMissionBrief,
    ClaimsPage,
    ClaimUserBrief,
    MissionAdminOut,
    MissionAdminPage,
    MissionCreate,
    MissionUpdate,
)
from app.services.missions import MISSION_TYPES, VERIFICATION_MODES

router = APIRouter(prefix="/v1/admin", tags=["admin"])


async def _validate_payload(
    *,
    type_: str,
    verification: str,
    points: int,
    start_at,
    end_at,
    scan_category_id: int | None,
    db: AsyncSession,
) -> None:
    """Validasi bisnis yang tidak bisa dinyatakan Pydantic (lihat juga test)."""
    if type_ not in MISSION_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Tipe misi harus salah satu dari: {', '.join(MISSION_TYPES)}.",
        )
    if verification not in VERIFICATION_MODES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Mode verifikasi harus salah satu dari: {', '.join(VERIFICATION_MODES)}.",
        )
    if start_at is not None and end_at is not None and start_at >= end_at:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Waktu mulai harus sebelum waktu selesai.")
    if scan_category_id is not None:
        if verification != "auto_scan":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Kategori scan hanya relevan untuk misi auto_scan.",
            )
        if await db.get(WasteCategory, scan_category_id) is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kategori sampah tidak dikenali.")


async def _claims_count(db: AsyncSession, mission_id: int, only_pending: bool = False) -> int:
    stmt = select(func.count()).select_from(UserMission).where(UserMission.mission_id == mission_id)
    if only_pending:
        stmt = stmt.where(UserMission.status == "pending")
    return int(await db.scalar(stmt) or 0)


async def _get_mission_or_404(db: AsyncSession, mission_id: int) -> Mission:
    mission = await db.get(Mission, mission_id)
    if mission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Misi tidak ditemukan.")
    return mission


def _admin_out(mission: Mission, claims_total: int, claims_pending: int) -> MissionAdminOut:
    return MissionAdminOut(
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
        is_active=mission.is_active,
        claims_total=claims_total,
        claims_pending=claims_pending,
        my_claim=None,
    )


@router.get("/missions", response_model=MissionAdminPage)
async def list_missions_admin(
    is_active: bool | None = None,
    verification: str | None = None,
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _user: User = Depends(require_roles("admin", "verifier", "editor")),
    db: AsyncSession = Depends(get_db),
) -> MissionAdminPage:
    filters = []
    if is_active is not None:
        filters.append(Mission.is_active.is_(is_active))
    if verification is not None:
        filters.append(Mission.verification == verification)
    if q:
        filters.append(Mission.title.ilike(f"%{q.strip()}%"))

    total = await db.scalar(select(func.count()).select_from(Mission).where(*filters))
    rows = (
        await db.scalars(
            select(Mission).where(*filters).order_by(Mission.id.desc()).offset(offset).limit(limit)
        )
    ).all()
    items = [
        _admin_out(
            m,
            await _claims_count(db, m.id),
            await _claims_count(db, m.id, only_pending=True),
        )
        for m in rows
    ]
    return MissionAdminPage(items=items, total=int(total or 0), limit=limit, offset=offset)


@router.post("/missions", response_model=MissionAdminOut, status_code=201)
async def create_mission(
    payload: MissionCreate,
    _user: User = Depends(require_roles("admin", "editor")),
    db: AsyncSession = Depends(get_db),
) -> MissionAdminOut:
    await _validate_payload(
        type_=payload.type,
        verification=payload.verification,
        points=payload.points,
        start_at=payload.start_at,
        end_at=payload.end_at,
        scan_category_id=payload.scan_category_id,
        db=db,
    )
    mission = Mission(
        title=payload.title.strip(),
        description=payload.description,
        type=payload.type,
        icon=payload.icon,
        points=payload.points,
        verification=payload.verification,
        scan_category_id=payload.scan_category_id,
        required_count=payload.required_count,
        start_at=payload.start_at,
        end_at=payload.end_at,
        is_active=payload.is_active,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)
    return _admin_out(mission, 0, 0)


@router.patch("/missions/{mission_id}", response_model=MissionAdminOut)
async def update_mission(
    mission_id: int,
    payload: MissionUpdate,
    _user: User = Depends(require_roles("admin", "editor")),
    db: AsyncSession = Depends(get_db),
) -> MissionAdminOut:
    mission = await _get_mission_or_404(db, mission_id)
    data = payload.model_dump(exclude_unset=True)

    merged = {
        "type_": data.get("type", mission.type),
        "verification": data.get("verification", mission.verification),
        "points": data.get("points", mission.points),
        "start_at": data.get("start_at", mission.start_at),
        "end_at": data.get("end_at", mission.end_at),
        "scan_category_id": data.get("scan_category_id", mission.scan_category_id),
    }
    await _validate_payload(db=db, **merged)

    for field, value in data.items():
        attr = "type_" if field == "type" else field
        setattr(mission, attr, value)
    await db.commit()
    await db.refresh(mission)
    return _admin_out(
        mission,
        await _claims_count(db, mission.id),
        await _claims_count(db, mission.id, only_pending=True),
    )


@router.delete("/missions/{mission_id}", status_code=204)
async def delete_mission(
    mission_id: int,
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
) -> None:
    mission = await _get_mission_or_404(db, mission_id)
    if await _claims_count(db, mission.id) > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Misi sudah punya klaim pengguna — nonaktifkan saja (jaga riwayat).",
        )
    await db.delete(mission)
    await db.commit()


@router.get("/claims", response_model=ClaimsPage)
async def list_claims(
    mission_status: str | None = Query(
        default=None, alias="status"
    ),  # in_progress|pending|approved|rejected
    mission_id: int | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _user: User = Depends(require_roles("admin", "verifier", "editor")),
    db: AsyncSession = Depends(get_db),
) -> ClaimsPage:
    """Antrian/data klaim misi (read-only pada Sprint 4)."""
    filters = []
    if mission_status is not None:
        filters.append(UserMission.status == mission_status)
    if mission_id is not None:
        filters.append(UserMission.mission_id == mission_id)

    total = await db.scalar(select(func.count()).select_from(UserMission).where(*filters))
    rows = (
        await db.execute(
            select(UserMission, User, Mission)
            .join(User, UserMission.user_id == User.id)
            .join(Mission, UserMission.mission_id == Mission.id)
            .where(*filters)
            .order_by(UserMission.submitted_at.desc(), UserMission.id.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()

    items = [
        ClaimAdminOut(
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
            user=ClaimUserBrief(
                id=str(claim_user.id),
                full_name=claim_user.full_name,
                city=claim_user.city,
            ),
            mission=ClaimMissionBrief(
                id=mission.id,
                title=mission.title,
                points=mission.points,
                verification=mission.verification,
            ),
        )
        for claim, claim_user, mission in rows
    ]
    return ClaimsPage(items=items, total=int(total or 0), limit=limit, offset=offset)
