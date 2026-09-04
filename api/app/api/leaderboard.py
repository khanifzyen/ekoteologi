"""Leaderboard MVP (Sprint 6) — backend saja, UI penuh fase 2 (rencana §4).

`GET /v1/leaderboard` membaca index `users.points` (PRD §5.10 #7 — sudah ada
sejak skema awal): sort DESC dilayani Postgres lewat backward index scan,
tanpa query agregasi berat. Aturan:

- Hanya pengguna `is_active=true` dengan `points > 0` (nonaktif & poin nol
  tidak dipajang).
- `rank` memakai window function `RANK() OVER (ORDER BY points DESC)` —
  kompetisi ketat: poin sama = peringkat sama; urutan tampil dieeterminate
  dgn nama. `me.rank` dihitung konsisten dgn rumus yang sama (1 + jumlah
  pemilik poin lebih tinggi) sehingga posisi di dalam & di luar jendela
  `limit` tidak pernah kontradiktif.
- Respons memuat `me` agar klien fase 2 bisa menampilkan "peringkatmu" walau
  tidak masuk jendela top-N.
- PII minimal: nama, kota, avatar, poin, level — tanpa email/role.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models import Level, User
from app.schemas.gamification import LeaderboardEntry, LeaderboardResponse
from app.services.levels import resolve_level

router = APIRouter(prefix="/v1", tags=["gamification"])


def _entry(*, rank: int, user: User, ladder: list[Level]) -> LeaderboardEntry:
    resolution = resolve_level(ladder, user.points)
    return LeaderboardEntry(
        rank=rank,
        user_id=str(user.id),
        full_name=user.full_name,
        avatar_url=user.avatar_url,
        city=user.city,
        points=user.points,
        level=resolution.level,
        level_title=resolution.title,
    )


def _leaderboard_filters():
    return (User.is_active.is_(True), User.points > 0)


@router.get("/leaderboard", response_model=LeaderboardResponse)
async def get_leaderboard(
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LeaderboardResponse:
    """Papan peringkat poin — index `users.points`, level dari tabel levels."""
    ladder = list((await db.scalars(select(Level).order_by(Level.min_points.asc()))).all())

    rank_col = func.rank().over(order_by=User.points.desc()).label("rank")
    rows = (
        await db.execute(
            select(User, rank_col)
            .where(*_leaderboard_filters())
            .order_by(User.points.desc(), User.full_name.asc(), User.id.asc())
            .limit(limit)
        )
    ).all()
    total = int(
        await db.scalar(select(func.count()).select_from(User).where(*_leaderboard_filters())) or 0
    )

    items = [_entry(rank=int(rank), user=row_user, ladder=ladder) for row_user, rank in rows]

    me_entry: LeaderboardEntry | None = None
    if user.is_active and user.points > 0:
        my_rank = (
            int(
                await db.scalar(
                    select(func.count())
                    .select_from(User)
                    .where(User.is_active.is_(True), User.points > user.points)
                )
                or 0
            )
            + 1
        )
        me_entry = _entry(rank=my_rank, user=user, ladder=ladder)

    return LeaderboardResponse(items=items, me=me_entry, total=total)
