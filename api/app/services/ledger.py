"""Point ledger service (Sprint 2) — PRD §5.10 keputusan #1.

`point_transactions` adalah append-only dan satu-satunya sumber kebenaran;
`users.points` hanyalah cache yang selalu di-update lewat service ini dalam
satu transaksi DB yang sama (atomik). Tidak ada jalur UPDATE/DELETE ledger.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PointTransaction, User


async def award_points(
    db: AsyncSession,
    *,
    user: User,
    amount: int,
    source: str,
    ref_id: int | None = None,
    note: str | None = None,
) -> int:
    """Catat poin ke ledger + sinkronkan cache `users.points`.

    Kembalikan total poin user setelah penambahan. `amount` harus > 0 —
    pengurangan poin (redeem/penyesuaian) menyusul di sprint masing-masing.
    Tidak melakukan commit — pemanggil mengatur batas transaksinya sendiri.
    """
    if amount <= 0:
        raise ValueError("amount harus positif — ledger hanya menerima penambahan.")
    db.add(
        PointTransaction(user_id=user.id, amount=amount, source=source, ref_id=ref_id, note=note)
    )
    user.points += amount
    return user.points


async def ledger_total(db: AsyncSession, user_id: uuid.UUID) -> int:
    """SUM ledger — sumber kebenaran (dipakai audit/rekonsiliasi)."""
    return await db.scalar(
        select(func.coalesce(func.sum(PointTransaction.amount), 0)).where(
            PointTransaction.user_id == user_id
        )
    )


async def sync_points_cache(db: AsyncSession, user: User) -> int:
    """Rekonsiliasi: hitung ulang `users.points` dari ledger (perbaiki drift cache)."""
    user.points = await ledger_total(db, user.id)
    return user.points
