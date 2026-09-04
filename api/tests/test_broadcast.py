"""Test composer push broadcast (Sprint 8): segmen, endpoint admin, audit,
broadcast di in-app list, dan event "misi baru".
"""

from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from app.models import AuditLog, Notification
from app.services.broadcast import (
    SEGMENT_ACTIVE_7D,
    SEGMENT_ALL,
    SEGMENT_INACTIVE_7D,
    SEGMENT_WITH_TOKEN,
    count_segment,
    resolve_segment,
    segment_filters,
)
from app.services.push import register_token
from tests.conftest import login_token, make_user

pytestmark = pytest.mark.asyncio(loop_scope="session")

VALID_TOKEN = "fKt7Qw2vS9pX1Lm3NzY6aBcD4eF5gH7iJ8kL0mN1oP2qR3sT4uV5wX6yZ7aB8cD"


# ── Fungsi murni segmen ──


async def test_segment_filters_selalu_aktif():
    today = date(2026, 9, 4)
    for segment in (SEGMENT_ALL, SEGMENT_ACTIVE_7D, SEGMENT_INACTIVE_7D, SEGMENT_WITH_TOKEN):
        filters = segment_filters(segment, today=today)
        assert len(filters) >= 1  # is_active selalu ada
    # Bandingkan lewat kompilasi SQL (objek ekspresi tidak sama-by-eq).
    tak_dikenal = str(segment_filters("tidak-ada", today=today)[0].compile())
    assert tak_dikenal == str(segment_filters(SEGMENT_ALL, today=today)[0].compile())


async def test_resolve_segment_fallback_all():
    assert resolve_segment("aktif_7hari") == "aktif_7hari"
    assert resolve_segment("") == SEGMENT_ALL
    assert resolve_segment("haram") == SEGMENT_ALL


async def test_count_segment_db(db_session):
    today = date.today()
    aktif = make_user(email="aktif@example.com", full_name="Aktif", role="user")
    aktif.last_active_date = today
    lama = make_user(email="lama@example.com", full_name="Lama", role="user")
    lama.last_active_date = today - timedelta(days=30)
    diblokir = make_user(email="blok@example.com", full_name="Blok", role="user")
    diblokir.is_active = False
    db_session.add_all([aktif, lama, diblokir])
    await db_session.commit()

    all_r, _ = await count_segment(db_session, SEGMENT_ALL)
    assert all_r == 2  # diblokir tidak pernah dihitung
    active_r, _ = await count_segment(db_session, SEGMENT_ACTIVE_7D)
    assert active_r == 1
    inactive_r, _ = await count_segment(db_session, SEGMENT_INACTIVE_7D)
    assert inactive_r == 1  # `lama` (30 hari) — `aktif` tidak masuk pasif


# ── Endpoint segmen (preview komposer) ──


async def test_segments_butuh_role_admin(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    assert (
        await client.get("/v1/admin/push/segments", headers={"Authorization": f"Bearer {token}"})
    ).status_code == 403


async def test_segments_rekap(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.get("/v1/admin/push/segments", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert [i["segment"] for i in body["items"]] == [
        SEGMENT_ALL,
        "aktif_7hari",
        "pasif_7hari",
        SEGMENT_WITH_TOKEN,
    ]
    semua = body["items"][0]
    assert semua["recipients"] == 1 and semua["tokens"] == 0


# ── Kirim broadcast ──


async def test_broadcast_butuh_role_admin(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await client.post(
        "/v1/admin/push/broadcast",
        json={"title": "Halo pengguna", "body": "Isi pengumuman panjang."},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403  # composer hanya admin — verifier/editor pun ditolak


async def test_broadcast_validasi_input(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}
    # Judul terlalu pendek (422 pydantic) & segmen tak dikenal (400).
    assert (
        await client.post(
            "/v1/admin/push/broadcast",
            json={"title": "Ha", "body": "Isi pengumuman panjang."},
            headers=headers,
        )
    ).status_code == 422
    assert (
        await client.post(
            "/v1/admin/push/broadcast",
            json={"title": "Judul sah", "body": "Isi pengumuman panjang.", "segment": "aneh"},
            headers=headers,
        )
    ).status_code == 400


async def test_broadcast_kirim_ke_token_segmen(client, admin_user, member_user, db_session, caplog):
    await register_token(db_session, user_id=member_user.id, token=VALID_TOKEN)
    await db_session.commit()

    token = await login_token(client, admin_user.email, "password123")
    with caplog.at_level("INFO", logger="ekoteologi.push"):
        resp = await client.post(
            "/v1/admin/push/broadcast",
            json={
                "title": "Misi spesial",
                "body": "Misi mingguan baru dibuka — cek layar Misi!",
                "segment": SEGMENT_ALL,
            },
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["recipients"] == 2 and body["tokens"] == 1 and body["sent"] == 1

    # Satu baris broadcast (user_id NULL) + rekap di payload.
    rows = (await db_session.scalars(select(Notification))).all()
    broadcasts = [r for r in rows if r.payload and r.payload.get("kind") == "broadcast"]
    assert len(broadcasts) == 1 and broadcasts[0].user_id is None
    assert broadcasts[0].payload["sent"] == 1

    # Audit eksplisit: rekap penerima tercatat dgn actor admin.
    audits = (
        await db_session.scalars(select(AuditLog).where(AuditLog.action == "push.broadcast"))
    ).all()
    assert len(audits) == 1
    assert str(audits[0].actor_id) == str(admin_user.id)
    assert audits[0].diff["recipients"] == 2 and audits[0].diff["sent"] == 1
    assert "PUSH BROADCAST" in caplog.text


async def test_broadcast_segmen_bertoken(client, admin_user, member_user, db_session):
    """Segmen `bertoken` hanya menghitung pemilik token FCM."""
    await register_token(db_session, user_id=member_user.id, token=VALID_TOKEN)
    await db_session.commit()

    token = await login_token(client, admin_user.email, "password123")
    resp = await client.post(
        "/v1/admin/push/broadcast",
        json={
            "title": "Khusus pengguna app",
            "body": "Terima kasih sudah memasang aplikasi.",
            "segment": SEGMENT_WITH_TOKEN,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["segment"] == SEGMENT_WITH_TOKEN
    assert body["recipients"] == 1  # hanya member yang punya token (admin tidak)
    assert body["tokens"] == 1 and body["sent"] == 1


# ── Riwayat broadcast ──


async def test_broadcast_history(client, admin_user, member_user):
    token = await login_token(client, admin_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}
    await client.post(
        "/v1/admin/push/broadcast",
        json={"title": "Pengumuman", "body": "Rilis internal pertama aplikasi."},
        headers=headers,
    )
    resp = await client.get("/v1/admin/push/history", headers=headers)
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1 and items[0]["payload"]["kind"] == "broadcast"


# ── Broadcast tampil di in-app list (semantics baca personal) ──


async def test_broadcast_tampil_di_list_notifikasi(client, admin_user, member_user, db_session):
    token_admin = await login_token(client, admin_user.email, "password123")
    await client.post(
        "/v1/admin/push/broadcast",
        json={"title": "Pengumuman umum", "body": "Aplikasi masuk internal testing."},
        headers={"Authorization": f"Bearer {token_admin}"},
    )

    token_member = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token_member}"}
    resp = await client.get("/v1/notifications", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1  # broadcast terlihat user lain
    assert body["unread_count"] == 0  # broadcast tidak dihitung badge (personal saja)

    # unread_only mengeluarkan broadcast (read_at-nya NULL, tapi bukan personal).
    resp = await client.get("/v1/notifications?unread_only=true", headers=headers)
    assert resp.json()["total"] == 0

    # Tandai semua dibaca tidak menyentuh broadcast (idempoten, tetap 204).
    resp = await client.post("/v1/notifications/read", headers=headers)
    assert resp.status_code == 204
    sisa = await db_session.scalar(
        select(func.count()).select_from(Notification).where(Notification.user_id.is_(None))
    )
    assert sisa == 1


async def test_notifikasi_personal_tetap_masuk_unread(client, member_user, db_session):
    from app.services.notifications import notify

    notify(
        db_session,
        user_id=member_user.id,
        title="Misi disetujui!",
        body="+50 poin",
        type_="mission",
    )
    await db_session.commit()
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/notifications", headers={"Authorization": f"Bearer {token}"})
    assert resp.json()["unread_count"] == 1  # perilaku Sprint 5 tidak berubah


# ── Event "misi baru" ──


async def test_misi_baru_memunculkan_broadcast(client, admin_user, db_session, caplog):
    token = await login_token(client, admin_user.email, "password123")
    with caplog.at_level("INFO", logger="ekoteologi.push"):
        resp = await client.post(
            "/v1/admin/missions",
            json={
                "title": "Misi Baru Sprint 8",
                "type": "daily",
                "points": 10,
                "verification": "manual",
                "is_active": True,
            },
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 201
    mission_id = resp.json()["id"]

    rows = (await db_session.scalars(select(Notification))).all()
    baru = [r for r in rows if (r.payload or {}).get("kind") == "new_mission"]
    assert len(baru) == 1 and baru[0].user_id is None
    assert baru[0].payload["mission_id"] == mission_id
    assert "Misi Baru Sprint 8" in baru[0].body
    assert "PUSH BROADCAST" not in caplog.text  # lewat jalur announce (bukan composer)


async def test_user_melihat_misi_baru_di_list(client, admin_user, member_user):
    token_admin = await login_token(client, admin_user.email, "password123")
    await client.post(
        "/v1/admin/missions",
        json={
            "title": "Misi Broadcast",
            "type": "daily",
            "points": 5,
            "verification": "manual",
            "is_active": True,
        },
        headers={"Authorization": f"Bearer {token_admin}"},
    )
    token_member = await login_token(client, member_user.email, "password123")
    resp = await client.get(
        "/v1/notifications", headers={"Authorization": f"Bearer {token_member}"}
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 1  # broadcast "misi baru" terlihat
