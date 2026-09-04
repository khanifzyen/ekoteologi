"""Test badge engine (Sprint 6) — kriteria JSONB → evaluasi (murni) + sinkron
idempoten + integrasi on-event (scan, klaim manual) dan lazy (`GET /v1/badges`).
"""

import pytest
from sqlalchemy import func, select

from app.models import Notification, PointTransaction, Scan, UserBadge, UserMission
from app.services.badges import (
    BadgeStats,
    collect_stats,
    evaluate_criteria,
    sync_user_badges,
)
from tests.conftest import login_token, make_user

pytestmark = pytest.mark.asyncio(loop_scope="session")

PNG_A = b"\x89PNG\r\n\x1a\n" + b"badge-foto-a" * 8
PNG_B = b"\x89PNG\r\n\x1a\n" + b"badge-foto-b" * 8


# ── Evaluasi murni ──


def test_evaluate_criteria_semua_jenis():
    stats = BadgeStats(scan_count=10, mission_done=2, streak=7, points_earned=1000, quiz_passed=3)
    assert evaluate_criteria({"type": "scan_count", "value": 10}, stats) is True
    assert evaluate_criteria({"type": "scan_count", "value": 11}, stats) is False
    assert evaluate_criteria({"type": "mission_done", "value": 1}, stats) is True
    assert evaluate_criteria({"type": "streak", "value": 7}, stats) is True
    assert evaluate_criteria({"type": "points_earned", "value": 1000}, stats) is True
    assert evaluate_criteria({"type": "quiz_passed", "value": 3}, stats) is True


def test_evaluate_criteria_fail_closed():
    stats = BadgeStats(scan_count=5)
    # Kriteria korup / tidak dikenal / nilai tidak masuk akal → TIDAK diraih.
    assert evaluate_criteria(None, stats) is False
    assert evaluate_criteria({}, stats) is False
    assert evaluate_criteria({"type": "jenis_asing", "value": 1}, stats) is False
    assert evaluate_criteria({"type": "scan_count"}, stats) is False
    assert evaluate_criteria({"type": "scan_count", "value": 0}, stats) is False
    assert evaluate_criteria({"type": "scan_count", "value": -3}, stats) is False
    assert evaluate_criteria({"type": "scan_count", "value": "banyak"}, stats) is False
    assert evaluate_criteria({"type": "scan_count", "value": True}, stats) is False


async def test_collect_stats_menghitung_dari_sumber_nyata(db_session):
    from datetime import date

    from app.models import Mission

    user = make_user(email="stat@example.com", full_name="Pengguna Stat")
    db_session.add(user)
    mission = Mission(title="Misi uji statistik", points=10, verification="manual")
    db_session.add(mission)
    await db_session.commit()

    db_session.add_all(
        [
            Scan(user_id=user.id, points=5),  # dihitung
            Scan(user_id=user.id, points=0),  # duplikat — tidak dihitung
            PointTransaction(user_id=user.id, amount=5, source="scan"),
        ]
    )
    await db_session.flush()
    db_session.add(
        UserMission(
            user_id=user.id,
            mission_id=mission.id,
            period_date=date.today(),
            status="approved",
            points_awarded=10,
        )
    )
    user.longest_streak = 7
    await db_session.commit()

    stats = await collect_stats(db_session, user)
    assert stats.scan_count == 1
    assert stats.mission_done == 1
    assert stats.streak == 7
    assert stats.points_earned == 5


# ── Sinkron + integrasi endpoint ──


async def _seed_all():
    from scripts.seed import seed

    return await seed()


async def test_scan_pertama_memberi_lencana_on_event(client, member_user, db_session):
    await _seed_all()
    token = await login_token(client, member_user.email, "password123")
    resp = await client.post(
        "/v1/scan",
        files={"file": ("foto.png", PNG_A, "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text

    # Lencana "Langkah Kecil" (scan_count=1) sudah diraih ON-EVENT —
    # tanpa perlu membuka tab Pencapaian dulu.
    rows = await db_session.execute(select(UserBadge).where(UserBadge.user_id == member_user.id))
    assert rows.scalars().all()  # minimal 1 baris lencana
    notif = (
        await db_session.scalars(
            select(Notification).where(
                Notification.user_id == member_user.id,
                Notification.type == "info",
            )
        )
    ).first()
    assert notif is not None and "Lencana baru" in (notif.title or "")


async def test_klaim_manual_memberi_lencana_misi_pertama(client, member_user, db_session):
    await _seed_all()
    from app.models import Mission

    mission = (
        await db_session.scalars(select(Mission).where(Mission.verification == "manual"))
    ).first()
    assert mission is not None

    token = await login_token(client, member_user.email, "password123")
    resp = await client.post(
        f"/v1/missions/{mission.id}/claim",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text

    badge_ids = set(
        await db_session.scalars(
            select(UserBadge.badge_id).where(UserBadge.user_id == member_user.id)
        )
    )
    from app.models import Badge

    codes = set((await db_session.scalars(select(Badge.code).where(Badge.id.in_(badge_ids)))).all())
    assert "misi_pertama" in codes
    assert "scan_pertama" not in codes  # belum scan — jangan ikut terberi


async def test_get_badges_lazy_dan_idempoten(client, member_user, db_session):
    """Lazy: user dengan rekor streak 7 hari langsung meraih `streak_7` saat
    membuka tab Pencapaian; memuat ulang tidak menggandakan baris."""
    await _seed_all()
    member_user.longest_streak = 7
    await db_session.commit()

    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    first = await client.get("/v1/badges", headers=headers)
    assert first.status_code == 200
    body = first.json()
    by_code = {b["code"]: b for b in body}
    assert len(body) == 10
    assert by_code["streak_7"]["earned"] is True
    assert by_code["scan_pertama"]["earned"] is False
    assert by_code["streak_7"]["earned_at"] is not None

    count = await db_session.scalar(
        select(func.count()).select_from(UserBadge).where(UserBadge.user_id == member_user.id)
    )
    assert count == 1

    second = await client.get("/v1/badges", headers=headers)
    body2 = second.json()
    assert next(b for b in body2 if b["code"] == "streak_7")["earned"] is True
    count2 = await db_session.scalar(
        select(func.count()).select_from(UserBadge).where(UserBadge.user_id == member_user.id)
    )
    assert count2 == 1  # idempoten — tetap satu baris


async def test_notifikasi_lencana_muncul_di_endpoint_notifikasi(client, member_user):
    await _seed_all()
    token = await login_token(client, member_user.email, "password123")
    await client.post(
        "/v1/scan",
        files={"file": ("foto.png", PNG_A, "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )
    resp = await client.get(
        "/v1/notifications?type=info", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1 and items[0]["payload"]["badge_code"] == "scan_pertama"


async def test_sync_user_badges_tanpa_user_tidak_gagal(db_session):
    import uuid

    ghost = await sync_user_badges(db_session, user=make_user(id=uuid.uuid4()))
    assert ghost == []
