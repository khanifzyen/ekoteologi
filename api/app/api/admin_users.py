"""Admin: daftar pengguna (Sprint 4) — tabel `admin/pengguna.html`.

Read-only: pencarian, filter role/status, offset pagination, level dihitung
dari tabel `levels` (pola profil Sprint 1). Aksi mutasi (blokir, ubah role,
reset poin — PRD §3) menyusul sprint berikutnya sesuai rencana.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, require_roles
from app.models import Level, User
from app.schemas.admin_users import AdminUserOut, UsersPage

router = APIRouter(prefix="/v1/admin", tags=["admin"])


def _level_for(levels: list[Level], points: int) -> tuple[int, str]:
    highest = None
    for lvl in levels:
        if lvl.min_points <= points and (highest is None or lvl.min_points > highest.min_points):
            highest = lvl
    if highest is None:
        return 1, "Pemula"
    return highest.level, highest.title


@router.get("/users", response_model=UsersPage)
async def list_users(
    q: str | None = Query(default=None, max_length=100),
    role: str | None = None,
    # active|blocked — None = semua (chip "Semua").
    user_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _user: User = Depends(require_roles("admin", "verifier", "editor")),
    db: AsyncSession = Depends(get_db),
) -> UsersPage:
    filters = []
    if q:
        needle = f"%{q.strip()}%"
        filters.append(
            or_(
                User.full_name.ilike(needle),
                User.email.ilike(needle),
                User.city.ilike(needle),
            )
        )
    if role is not None:
        filters.append(User.role == role)
    if user_status == "active":
        filters.append(User.is_active.is_(True))
    elif user_status == "blocked":
        filters.append(User.is_active.is_(False))

    total = await db.scalar(select(func.count()).select_from(User).where(*filters))
    rows = (
        await db.scalars(
            select(User)
            .where(*filters)
            .order_by(User.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()
    levels = list((await db.scalars(select(Level).order_by(Level.min_points.asc()))).all())

    items: list[AdminUserOut] = []
    for u in rows:
        level, level_title = _level_for(levels, u.points)
        items.append(
            AdminUserOut(
                id=str(u.id),
                full_name=u.full_name,
                email=u.email,
                city=u.city,
                points=u.points,
                role=u.role,
                is_active=u.is_active,
                level=level,
                level_title=level_title,
                created_at=u.created_at,
            )
        )
    return UsersPage(items=items, total=int(total or 0), limit=limit, offset=offset)
