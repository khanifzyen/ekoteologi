"""Test point ledger service (Sprint 2): append-only + sinkronisasi cache users.points."""

import pytest
from sqlalchemy import select

from app.models import PointTransaction, User
from app.services.ledger import award_points, ledger_total, sync_points_cache
from tests.conftest import make_user

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_award_points_menulis_ledger_dan_menyinkron_cache(db_session):
    user = make_user(email="ledger1@example.com")
    db_session.add(user)
    await db_session.commit()

    total = await award_points(
        db_session, user=user, amount=5, source="scan", ref_id=42, note="Scan: botol"
    )
    assert total == 5
    await db_session.commit()

    row = (
        await db_session.scalars(
            select(PointTransaction).where(PointTransaction.user_id == user.id)
        )
    ).first()
    assert row is not None
    assert row.amount == 5
    assert row.source == "scan"
    assert row.ref_id == 42
    assert row.note == "Scan: botol"
    assert user.points == 5  # cache tersinkron dgn ledger


async def test_award_points_berkali_mengakumulasi(db_session):
    user = make_user(email="ledger2@example.com")
    db_session.add(user)
    await db_session.commit()

    await award_points(db_session, user=user, amount=5, source="scan")
    await award_points(db_session, user=user, amount=10, source="mission")
    await db_session.commit()

    assert user.points == 15
    assert await ledger_total(db_session, user.id) == 15


async def test_award_points_menolak_nol_dan_negatif(db_session):
    user = make_user(email="ledger3@example.com")
    db_session.add(user)
    await db_session.commit()

    with pytest.raises(ValueError):
        await award_points(db_session, user=user, amount=0, source="scan")
    with pytest.raises(ValueError):
        await award_points(db_session, user=user, amount=-5, source="adjustment")
    assert user.points == 0
    assert await ledger_total(db_session, user.id) == 0


async def test_sync_points_cache_merekonsiliasi_drift(db_session):
    """Cache users.points bisa drift (mis. edit manual); ledger adalah sumber kebenaran."""
    user: User = make_user(email="ledger4@example.com")
    db_session.add(user)
    await db_session.commit()

    await award_points(db_session, user=user, amount=7, source="scan")
    await award_points(db_session, user=user, amount=3, source="quiz")
    await db_session.commit()

    user.points = 999  # simulasi drift cache
    total = await sync_points_cache(db_session, user)
    assert total == 10
    assert user.points == 10
