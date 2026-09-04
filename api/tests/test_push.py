"""Test push FCM (Sprint 6) — simpan/hapus token `fcm_tokens`, abstraksi
`PushSender` (log vs fcm), dan `push_notification()` best-effort.
"""

import logging

import pytest
from sqlalchemy import func, select

from app.models import FcmToken
from app.services.push import (
    FcmHttpV1Sender,
    LogPushSender,
    get_push_sender,
    push_notification,
    register_token,
)
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")

VALID_TOKEN = "fKt7Qw2vS9pX1Lm3NzY6aBcD4eF5gH7iJ8kL0mN1oP2qR3sT4uV5wX6yZ7aB8cD"  # 64 char


# ── Endpoint token ──


async def test_token_butuh_auth(client):
    assert (await client.post("/v1/push/token", json={"token": VALID_TOKEN})).status_code == 401
    assert (
        await client.request("DELETE", "/v1/push/token", json={"token": VALID_TOKEN})
    ).status_code == 401


async def test_register_token_idempoten(client, member_user, db_session):
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}
    r1 = await client.post(
        "/v1/push/token",
        json={"token": VALID_TOKEN, "platform": "android"},
        headers=headers,
    )
    assert r1.status_code == 200 and r1.json()["registered"] is True
    r2 = await client.post("/v1/push/token", json={"token": VALID_TOKEN}, headers=headers)
    assert r2.status_code == 200

    count = await db_session.scalar(select(func.count()).select_from(FcmToken))
    assert count == 1  # upsert — tidak duplikat


async def test_register_token_pindah_akun(client, member_user, admin_user, db_session):
    token_admin = await login_token(client, admin_user.email, "password123")
    await client.post(
        "/v1/push/token",
        json={"token": VALID_TOKEN},
        headers={"Authorization": f"Bearer {token_admin}"},
    )
    # Perangkat sama dipakai login akun lain → token berpindah (bukan 409).
    token_member = await login_token(client, member_user.email, "password123")
    resp = await client.post(
        "/v1/push/token",
        json={"token": VALID_TOKEN},
        headers={"Authorization": f"Bearer {token_member}"},
    )
    assert resp.status_code == 200
    row = (await db_session.scalars(select(FcmToken))).one()
    assert str(row.user_id) == str(member_user.id)


async def test_register_token_terlalu_pendek_ditolak(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await client.post(
        "/v1/push/token",
        json={"token": "pendek"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


async def test_delete_token_milik_sendiri_saja(client, member_user, admin_user, db_session):
    await register_token(db_session, user_id=member_user.id, token=VALID_TOKEN)
    await db_session.commit()

    token_admin = await login_token(client, admin_user.email, "password123")
    resp = await client.request(
        "DELETE",
        "/v1/push/token",
        json={"token": VALID_TOKEN},
        headers={"Authorization": f"Bearer {token_admin}"},
    )
    assert resp.status_code == 200
    assert resp.json()["registered"] is False  # token org lain — tidak dihapus
    assert (await db_session.scalar(select(func.count()).select_from(FcmToken))) == 1

    token_member = await login_token(client, member_user.email, "password123")
    resp2 = await client.request(
        "DELETE",
        "/v1/push/token",
        json={"token": VALID_TOKEN},
        headers={"Authorization": f"Bearer {token_member}"},
    )
    assert resp2.json()["registered"] is False and "dihapus" in resp2.json()["message"]
    assert (await db_session.scalar(select(func.count()).select_from(FcmToken))) == 0


# ── Abstraksi pengirim ──


async def test_log_sender_mencatat_dan_sukses(caplog):
    with caplog.at_level(logging.INFO, logger="ekoteologi.push"):
        ok = await LogPushSender().send(
            token=VALID_TOKEN, title="Misi disetujui!", body="+50 poin", data={"type": "mission"}
        )
    assert ok is True
    assert "Misi disetujui!" in caplog.text


async def test_get_push_sender_default_log():
    assert isinstance(get_push_sender(), LogPushSender)


async def test_get_push_sender_fcm_tanpa_kredensial_fallback_log(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "push_mode", "fcm")
    monkeypatch.setattr(get_settings(), "fcm_credentials_file", "")
    assert isinstance(get_push_sender(), LogPushSender)  # fail-safe ke log + warning


def test_fcm_sender_kredensial_tidak_lengkap():
    sender = FcmHttpV1Sender("/tidak/ada/file.json", "proj")
    with pytest.raises(RuntimeError, match="tidak ditemukan"):
        sender._load_credentials()

    import json
    import tempfile
    from pathlib import Path

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump({"client_email": "a@b.c"}, fh)
        path = fh.name
    try:
        with pytest.raises(RuntimeError, match="tidak lengkap"):
            FcmHttpV1Sender(path, "proj")._load_credentials()
    finally:
        Path(path).unlink(missing_ok=True)


# ── Pipe notifikasi → push ──


async def _notification(db_session, user_id, title="Halo"):
    from app.models import Notification

    notif = Notification(user_id=user_id, title=title, body="isi", type="mission")
    db_session.add(notif)
    await db_session.commit()
    await db_session.refresh(notif)
    return notif


async def test_push_notification_kirim_ke_semua_token_user(db_session, member_user, admin_user):
    await register_token(db_session, user_id=member_user.id, token=VALID_TOKEN)
    await register_token(db_session, user_id=member_user.id, token=VALID_TOKEN + "XYZABC")
    await register_token(db_session, user_id=admin_user.id, token="Z" * 64)
    await db_session.commit()

    notif = await _notification(db_session, member_user.id)
    sender = LogPushSender()
    sent = await push_notification(db_session, notif, sender=sender)
    assert sent == 2  # hanya token milik pemilik notifikasi


async def test_push_notification_tanpa_token_atau_broadcast(db_session, member_user):
    notif = await _notification(db_session, member_user.id)
    assert await push_notification(db_session, notif, sender=LogPushSender()) == 0

    broadcast = await _notification(db_session, None)
    assert await push_notification(db_session, broadcast, sender=LogPushSender()) == 0
