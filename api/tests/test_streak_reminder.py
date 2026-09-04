"""Test streak reminder (Sprint 8): fungsi murni, target, idempoten harian,
integrasi push, dan endpoint admin.
"""

from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import AppSetting, Notification, User
from app.services.push import LogPushSender, register_token
from app.services.streak import days_until_bonus
from app.services.streak_reminder import (
    SETTING_KEY,
    is_due,
    reminder_body,
    reminder_targets,
    reminder_title,
    run_streak_reminders,
    scheduler_should_run,
)
from tests.conftest import login_token, make_user

pytestmark = pytest.mark.asyncio(loop_scope="session")

VALID_TOKEN = "fKt7Qw2vS9pX1Lm3NzY6aBcD4eF5gH7iJ8kL0mN1oP2qR3sT4uV5wX6yZ7aB8cD"

TODAY = date(2026, 9, 4)
YESTERDAY = TODAY - timedelta(days=1)


# ── Fungsi murni ──


async def test_is_due_sekali_per_hari_setelah_jam():
    assert is_due(today=TODAY, last_run=None, after_hour=8, now_hour=8) is True
    assert is_due(today=TODAY, last_run=None, after_hour=8, now_hour=7) is False
    assert is_due(today=TODAY, last_run=TODAY, after_hour=8, now_hour=9) is False  # sudah jalan
    assert is_due(today=TODAY, last_run=YESTERDAY, after_hour=8, now_hour=9) is True


async def test_reminder_copy_angka_dari_streak():
    assert reminder_title(3) == "Jaga streak 3 hari-mu!"
    body = reminder_body(3, bonus_every_days=6)
    assert "3 hari" in body
    assert "3 hari lagi" in body  # days_until_bonus(3, 6) == 3
    assert "bonus" in body
    # Tanpa bonus (env 0) — pesan tetap jujur tanpa janji bonus.
    assert "bonus" not in reminder_body(3, bonus_every_days=0)
    # Konsistensi dgn engine streak Sprint 5 (satu sumber angka).
    assert days_until_bonus(5, 6) == 1


async def test_scheduler_gate_murni():
    assert scheduler_should_run(enabled=True, now_hour=9, after_hour=8) is True
    assert scheduler_should_run(enabled=True, now_hour=7, after_hour=8) is False
    assert scheduler_should_run(enabled=False, now_hour=9, after_hour=8) is False


# ── Target & eksekusi ──


async def _seed_users(db_session) -> dict[str, User]:
    """4 profil: berisiko (target), aktif hari ini, streak 1, sudah bolong."""
    risiko = make_user(email="risiko@example.com", full_name="Risiko", role="user")
    risiko.current_streak = 5
    risiko.longest_streak = 5
    risiko.last_active_date = YESTERDAY

    aktif = make_user(email="aktif@example.com", full_name="Aktif", role="user")
    aktif.current_streak = 7
    aktif.last_active_date = TODAY  # sudah aktif hari ini

    pemula = make_user(email="pemula@example.com", full_name="Pemula", role="user")
    pemula.current_streak = 1  # streak 1 — belum layak reminder
    pemula.last_active_date = YESTERDAY

    bolong = make_user(email="bolong@example.com", full_name="Bolong", role="user")
    bolong.current_streak = 9
    bolong.last_active_date = TODAY - timedelta(days=3)  # sudah putus

    db_session.add_all([risiko, aktif, pemula, bolong])
    await db_session.commit()
    return {"risiko": risiko, "aktif": aktif, "pemula": pemula, "bolong": bolong}


async def test_reminder_targets_hanya_berisiko(db_session):
    users = await _seed_users(db_session)
    targets = await reminder_targets(db_session, today=TODAY)
    assert [u.id for u in targets] == [users["risiko"].id]


async def test_run_streak_reminders_idempoten_dan_push(db_session):
    users = await _seed_users(db_session)
    sender = LogPushSender()
    now = datetime.combine(TODAY, datetime.min.time()).astimezone() + timedelta(hours=9)

    run1 = await run_streak_reminders(db_session, now=now, sender=sender)
    assert (run1.targets, run1.skipped) == (1, False)
    assert run1.sent == 0  # risiko belum punya token

    await register_token(db_session, user_id=users["risiko"].id, token=VALID_TOKEN)
    await db_session.commit()
    # Penanda harian sudah terisi → eksekusi kedua skip walau token kini ada.
    run2 = await run_streak_reminders(db_session, now=now, sender=sender)
    assert run2.skipped is True and run2.targets == 0

    # Kekuatan (force) mengabaikan penanda — utk demo/ops.
    run3 = await run_streak_reminders(db_session, now=now, sender=sender, force=True)
    assert run3.targets == 1 and run3.sent == 1

    rows = (await db_session.scalars(select(Notification))).all()
    reminders = [r for r in rows if (r.payload or {}).get("kind") == "reminder"]
    assert len(reminders) == 2  # run1 + run3 (force)
    assert reminders[0].user_id == users["risiko"].id
    assert reminders[0].type == "streak" and reminders[0].payload["streak"] == 5

    marker = await db_session.get(AppSetting, SETTING_KEY)
    assert marker is not None and marker.value["date"] == TODAY.isoformat()


async def test_reminder_hormati_jam_via_is_due_bukan_only_penanda(db_session):
    """Sebelum jam reminder & belum jalan hari ini → skipped (bukan kirim)."""
    await _seed_users(db_session)
    pagi = datetime.combine(TODAY, datetime.min.time()).astimezone() + timedelta(hours=3)
    run = await run_streak_reminders(db_session, now=pagi)
    assert run.skipped is True and run.targets == 0


# ── Endpoint admin ──


async def test_endpoint_streak_reminder_role_guard(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await client.post(
        "/v1/admin/notifications/streak-reminder",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


async def test_endpoint_streak_reminder_admin(client, admin_user, db_session):
    await _seed_users(db_session)
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.post(
        "/v1/admin/notifications/streak-reminder?force=true",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["targets"] == 1 and body["skipped"] is False
    # Tanpa force kedua kali → skipped (penanda harian).
    resp2 = await client.post(
        "/v1/admin/notifications/streak-reminder",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp2.json()["skipped"] is True
