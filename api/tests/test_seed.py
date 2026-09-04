"""Seed data awal (Sprint 1): kategori sampah, level, badge — idempoten."""

import pytest
from sqlalchemy import func, select

from app.models import Badge, Level, WasteCategory
from scripts.seed import seed

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_seed_mengisi_tiga_tabel(db_session):
    counts = await seed()
    assert counts["waste_categories"] >= 7
    assert counts["levels"] == 10
    assert counts["badges"] >= 10

    cats = {name for name in (await db_session.scalars(select(WasteCategory.name))).all()}
    assert {"Organik", "Plastik", "B3", "Residu"} <= cats

    b3 = (await db_session.scalars(select(WasteCategory).where(WasteCategory.name == "B3"))).first()
    assert b3 is not None and b3.base_points >= 5 and b3.icon


async def test_seed_idempoten(db_session):
    first = await seed()
    second = await seed()
    assert first == second

    assert (await db_session.scalar(select(func.count()).select_from(WasteCategory))) == first[
        "waste_categories"
    ]
    assert (await db_session.scalar(select(func.count()).select_from(Level))) == first["levels"]
    assert (await db_session.scalar(select(func.count()).select_from(Badge))) == first["badges"]


async def test_seed_level_berjenjang(db_session):
    await seed()
    rows = (await db_session.scalars(select(Level).order_by(Level.level))).all()
    assert rows[0].min_points == 0
    for prev, cur in zip(rows, rows[1:], strict=False):
        assert cur.min_points > prev.min_points
        assert cur.level == prev.level + 1
        assert len(cur.title) <= 50


async def test_seed_badge_kriteria_jsonb(db_session):
    await seed()
    badge = (await db_session.scalars(select(Badge).where(Badge.code == "scan_pertama"))).first()
    assert badge is not None
    assert badge.criteria == {"type": "scan_count", "value": 1}
