"""Test streak harian (Sprint 5) — engine murni + endpoint `GET /v1/streak`
+ integrasi via scan/klaim/approve (`touch_streak`).
"""

from datetime import date, timedelta

import pytest

from app.services.streak import (
    build_week,
    days_until_bonus,
    effective_streak,
    next_streak,
)
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date(2026, 9, 4)

# Dua foto berbeda (hash beda) agar kedua scan bernilai poin.
PNG_A = b"\x89PNG\r\n\x1a\n" + b"streak-foto-a" * 8
PNG_B = b"\x89PNG\r\n\x1a\n" + b"streak-foto-b" * 8


# ── Engine murni ──


def test_next_streak_belum_pernah_aktif():
    assert next_streak(current=0, last_active_date=None, today=TODAY) == 1


def test_next_streak_lanjut_kemarin():
    assert next_streak(current=5, last_active_date=TODAY - timedelta(days=1), today=TODAY) == 6


def test_next_streak_reset_setelah_bolong():
    assert next_streak(current=9, last_active_date=TODAY - timedelta(days=3), today=TODAY) == 1


def test_next_streak_idempoten_hari_sama():
    assert next_streak(current=4, last_active_date=TODAY, today=TODAY) == 4


def test_effective_streak_ditampilkan_selama_belum_pasti_putus():
    # Aktif hari ini / kemarin → streak masih dipajang.
    assert effective_streak(current=5, last_active_date=TODAY, today=TODAY) == 5
    assert effective_streak(current=5, last_active_date=TODAY - timedelta(days=1), today=TODAY) == 5
    # Bolong ≥2 hari → jujur 0.
    assert effective_streak(current=5, last_active_date=TODAY - timedelta(days=2), today=TODAY) == 0
    assert effective_streak(current=0, last_active_date=None, today=TODAY) == 0


def test_days_until_bonus_sesuai_mockup():
    # Mockup `beranda.html`: "Streak 5 hari! … 1 hari lagi untuk bonus +20 poin"
    # → bonus jatuh tiap kelipatan 6.
    assert days_until_bonus(5, 6) == 1
    assert days_until_bonus(6, 6) == 6  # bonus ke-6 baru diraih, berikutnya ke-12
    assert days_until_bonus(1, 6) == 5
    assert days_until_bonus(4, 0) == 0  # bonus mati


def test_build_week_tujuh_hari_berakhir_hari_ini():
    week = build_week(TODAY, {TODAY, TODAY - timedelta(days=1), TODAY - timedelta(days=5)})
    assert len(week) == 7
    assert week[-1]["date"] == TODAY and week[-1]["active"] is True
    assert week[-2]["active"] is True
    assert week[0]["date"] == TODAY - timedelta(days=6)
    # Aktif: hari ini, kemarin, dan 5 hari lalu (index 1) — sisanya mati.
    assert week[1]["active"] is True
    assert week[4]["active"] is False
    assert week[5]["active"] is True  # kemarin aktif (T-1)


# ── Integrasi endpoint & aksi ──


async def test_streak_butuh_auth(client):
    assert (await client.get("/v1/streak")).status_code == 401


async def test_streak_kosong_untuk_user_baru(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/streak", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["current_streak"] == 0
    assert body["active_today"] is False
    assert body["last_active_date"] is None
    assert body["bonus_points"] == 20
    assert body["bonus_every_days"] == 6
    assert len(body["week"]) == 7
    assert all(d["active"] is False for d in body["week"])


async def _do_scan(client, token, content: bytes):
    return await client.post(
        "/v1/scan",
        files={"file": ("foto.png", content, "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )


async def test_scan_menaikkan_streak_dan_kalender(client, member_user, db_session):
    from scripts.seed import seed

    await seed()  # kategori utk LLM mock
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    r1 = await _do_scan(client, token, PNG_A)
    assert r1.status_code == 200, r1.text
    r2 = await _do_scan(client, token, PNG_B)
    assert r2.status_code == 200

    resp = await client.get("/v1/streak", headers=headers)
    body = resp.json()
    assert body["current_streak"] == 1  # dua scan di hari sama = 1 hari streak
    assert body["active_today"] is True
    assert body["week"][-1]["active"] is True
    assert body["longest_streak"] == 1


async def test_bonus_streak_kelipatan_enam(client, member_user, db_session):
    """Bonus +20 di hari ke-6: ledger `streak`, notifikasi, event `streak_hari`."""
    from datetime import datetime

    from sqlalchemy import select

    from app.models import AnalyticsEvent, Notification, PointTransaction
    from app.services.streak import touch_streak

    # Simulasikan 5 hari berturut-turut lewat manipulasi field user, lalu
    # touch hari ini = hari ke-6 → bonus.
    member_user.current_streak = 5
    member_user.longest_streak = 5
    member_user.last_active_date = datetime.now().astimezone().date() - timedelta(days=1)
    await db_session.commit()

    result = await touch_streak(db_session, user=member_user)
    await db_session.commit()
    assert result.incremented is True
    assert result.streak == 6
    assert result.bonus_awarded == 20

    bonus_rows = (
        await db_session.scalars(
            select(PointTransaction).where(PointTransaction.source == "streak")
        )
    ).all()
    assert len(bonus_rows) == 1 and bonus_rows[0].amount == 20

    notif = (
        await db_session.scalars(select(Notification).where(Notification.type == "streak"))
    ).first()
    assert notif is not None and "+20" in notif.body

    events = (
        await db_session.scalars(select(AnalyticsEvent).where(AnalyticsEvent.name == "streak_hari"))
    ).all()
    assert len(events) == 1 and events[0].payload["streak"] == 6

    # Idempoten: touch kedua di hari sama tidak menambah bonus.
    result2 = await touch_streak(db_session, user=member_user)
    assert result2.incremented is False and result2.bonus_awarded == 0
    bonus_rows2 = (
        await db_session.scalars(
            select(PointTransaction).where(PointTransaction.source == "streak")
        )
    ).all()
    assert len(bonus_rows2) == 1
