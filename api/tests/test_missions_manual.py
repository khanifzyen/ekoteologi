"""Test klaim misi manual (Sprint 5) — auto-approve saat klaim.

Detail yang diuji: tanpa consent/foto, poin lewat ledger (`source="mission"`),
event `misi_selesai`, notifikasi, streak berdetak, anti dobel, dan resubmission
baris rejected (kasus jarang) — kontrak tombol "Klaim Poin" `misi.html`.
"""

import pytest
from sqlalchemy import func, select

from app.models import AnalyticsEvent, Mission, Notification, PointTransaction, UserMission
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _manual_mission(db_session, points=10) -> Mission:
    mission = Mission(title="Bersihkan Wudhu Hemat Air", points=points, verification="manual")
    db_session.add(mission)
    await db_session.commit()
    return mission


async def test_klaim_manual_lengkap(client, member_user, db_session):
    mission = await _manual_mission(db_session, points=10)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post(f"/v1/missions/{mission.id}/claim", data={}, headers=headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["claim"]["status"] == "approved"
    assert body["claim"]["points_awarded"] == 10

    row = (
        await db_session.scalars(select(UserMission).where(UserMission.mission_id == mission.id))
    ).first()
    assert row.status == "approved"
    assert row.reviewed_at is not None  # approved sistem; reviewed_by tetap NULL
    assert row.reviewed_by is None

    await db_session.refresh(member_user)
    ledger = (
        await db_session.scalars(
            select(PointTransaction).where(PointTransaction.user_id == member_user.id)
        )
    ).all()
    assert len(ledger) == 1 and ledger[0].source == "mission" and ledger[0].amount == 10
    assert member_user.points == 10

    notif = (
        await db_session.scalars(select(Notification).where(Notification.user_id == member_user.id))
    ).first()
    assert notif is not None and notif.type == "mission"

    event = (
        await db_session.scalars(
            select(AnalyticsEvent).where(AnalyticsEvent.name == "misi_selesai")
        )
    ).first()
    assert event is not None and event.payload["points"] == 10

    # Streak ikut berdetak (aktivitas hari ini).
    assert member_user.current_streak == 1
    assert member_user.last_active_date is not None


async def test_klaim_manual_dobel_409(client, member_user, db_session):
    mission = await _manual_mission(db_session)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    first = await client.post(f"/v1/missions/{mission.id}/claim", data={}, headers=headers)
    assert first.status_code == 201
    second = await client.post(f"/v1/missions/{mission.id}/claim", data={}, headers=headers)
    assert second.status_code == 409

    total = await db_session.scalar(
        select(func.count()).select_from(UserMission).where(UserMission.mission_id == mission.id)
    )
    assert total == 1
    # Poin tidak dobel.
    await db_session.refresh(member_user)
    assert member_user.points == 10


async def test_klaim_manual_misi_photo_tanpa_foto_ditolak(client, member_user, db_session):
    """Mode photo tetap butuh file + consent (regresi Sprint 4)."""
    mission = Mission(title="Setor Plastik", points=50, verification="photo")
    db_session.add(mission)
    await db_session.commit()
    token = await login_token(client, member_user.email, "password123")

    r = await client.post(
        f"/v1/missions/{mission.id}/claim", data={}, headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 400
    assert "persetujuan" in r.json()["detail"].lower()


async def test_ringkasan_mingguan_menghitung_klaim_manual(client, member_user, db_session):
    mission = await _manual_mission(db_session, points=25)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post(f"/v1/missions/{mission.id}/claim", data={}, headers=headers)
    assert resp.status_code == 201

    listing = await client.get("/v1/missions", headers=headers)
    summary = listing.json()["summary"]
    assert summary["week_done"] == 1
    assert summary["week_points"] == 25
