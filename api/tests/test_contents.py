"""Test konten harian (Sprint 6) — CRUD admin `daily_contents` + penjadwalan
`publish_date` + endpoint mobile `GET /v1/daily-content` dgn fallback bank quote.
"""

from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from app.models import DailyContent
from app.services.quotes import daily_fallback_quote
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today()
TOMORROW = TODAY + timedelta(days=1)

PAYLOAD = {
    "publish_date": TOMORROW.isoformat(),
    "type": "ayat",
    "title": "Kutipan uji",
    "body": "Dia menciptakan kamu dari bumi dan memakmurkannya.",
    "source": "QS Hud: 61",
    "eco_action": "setor 1 botol ke bank sampah",
}


def _admin_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Guard & CRUD admin ──


async def test_crud_konten_butuh_role_admin(client, member_user, db_session):
    token_user = await login_token(client, member_user.email, "password123")
    headers = _admin_headers(token_user)
    assert (
        await client.post("/v1/admin/contents", json=PAYLOAD, headers=headers)
    ).status_code == 403
    assert (await client.get("/v1/admin/contents", headers=headers)).status_code == 403


async def test_buat_dan_daftar_konten(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.post("/v1/admin/contents", json=PAYLOAD, headers=_admin_headers(token))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["publish_date"] == TOMORROW.isoformat()
    assert body["is_published"] is False  # besok — belum tayang

    listing = (await client.get("/v1/admin/contents", headers=_admin_headers(token))).json()
    assert isinstance(listing, list) and len(listing) == 1
    assert listing[0]["source"] == "QS Hud: 61"


async def test_tanggal_ganda_ditolak_409(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    r1 = await client.post("/v1/admin/contents", json=PAYLOAD, headers=_admin_headers(token))
    assert r1.status_code == 201
    clash = {**PAYLOAD, "title": "Konten kedua"}
    r2 = await client.post("/v1/admin/contents", json=clash, headers=_admin_headers(token))
    assert r2.status_code == 409
    assert "sudah terisi" in r2.json()["detail"]


async def test_tipe_konten_tervalidasi(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    bad = {**PAYLOAD, "type": "puisi", "publish_date": TODAY.isoformat()}
    resp = await client.post("/v1/admin/contents", json=bad, headers=_admin_headers(token))
    assert resp.status_code == 400
    assert "ayat" in resp.json()["detail"]


async def test_patch_menggeser_jadwal_dan_deteksi_bentrok(client, admin_user, db_session):
    token = await login_token(client, admin_user.email, "password123")
    r1 = await client.post("/v1/admin/contents", json=PAYLOAD, headers=_admin_headers(token))
    content_id = r1.json()["id"]

    # Geser ke hari ini → is_published true.
    patched = await client.patch(
        f"/v1/admin/contents/{content_id}",
        json={"publish_date": TODAY.isoformat(), "eco_action": "pilah organik hari ini"},
        headers=_admin_headers(token),
    )
    assert patched.status_code == 200
    assert patched.json()["is_published"] is True
    assert patched.json()["eco_action"] == "pilah organik hari ini"

    # Konten kedua di tanggal lain, lalu coba geser ke tanggal konten pertama → 409.
    r2 = await client.post(
        "/v1/admin/contents",
        json={**PAYLOAD, "publish_date": (TOMORROW + timedelta(days=2)).isoformat()},
        headers=_admin_headers(token),
    )
    second_id = r2.json()["id"]
    bentrok = await client.patch(
        f"/v1/admin/contents/{second_id}",
        json={"publish_date": TODAY.isoformat()},
        headers=_admin_headers(token),
    )
    assert bentrok.status_code == 409


async def test_delete_konten_admin_saja(client, admin_user, db_session):
    token = await login_token(client, admin_user.email, "password123")
    created = await client.post("/v1/admin/contents", json=PAYLOAD, headers=_admin_headers(token))
    content_id = created.json()["id"]

    # Editor boleh menulis tapi bukan admin → hapus ditolak.
    from tests.conftest import make_user

    editor = make_user(email="editor@example.com", full_name="Editor", role="editor")
    db_session.add(editor)
    await db_session.commit()
    token_editor = await login_token(client, editor.email, "password123")
    resp_editor = await client.delete(
        f"/v1/admin/contents/{content_id}", headers=_admin_headers(token_editor)
    )
    assert resp_editor.status_code == 403

    resp = await client.delete(f"/v1/admin/contents/{content_id}", headers=_admin_headers(token))
    assert resp.status_code == 204
    count = await db_session.scalar(select(func.count()).select_from(DailyContent))
    assert count == 0


# ── Endpoint mobile + fallback ──


async def test_daily_content_butuh_auth(client):
    assert (await client.get("/v1/daily-content")).status_code == 401


async def test_daily_content_tanpa_jadwal_fallback_bank(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/daily-content", headers=_admin_headers(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["fallback"] is True
    assert body["date"] == TODAY.isoformat()
    assert body["eco_action"] is None  # fallback tidak mengarang aksi
    expected = daily_fallback_quote(TODAY)
    assert body["body"] == expected.text
    assert body["source"] == expected.source


async def test_daily_content_jadwal_hari_ini_tayang(client, member_user, db_session):
    db_session.add(
        DailyContent(
            publish_date=TODAY,
            type="hadis",
            title="Kutipan hari ini",
            body="Bumi itu hijau dan manis…",
            source="HR Muslim no. 2742",
            eco_action="hemat air wudhu",
        )
    )
    await db_session.commit()

    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/daily-content", headers=_admin_headers(token))
    body = resp.json()
    assert body["fallback"] is False
    assert body["type"] == "hadis"
    assert body["eco_action"] == "hemat air wudhu"
    assert body["body"].startswith("Bumi itu hijau")


async def test_daily_content_jadwal_besok_belum_tayang(client, member_user, db_session):
    db_session.add(DailyContent(publish_date=TOMORROW, type="refleksi", body="Besok"))
    await db_session.commit()
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/daily-content", headers=_admin_headers(token))
    assert resp.json()["fallback"] is True  # konten besok tidak bocor ke hari ini


# ── Fallback deterministik ──


def test_daily_fallback_quote_deterministik_per_tanggal():
    # Hari sama → kutipan sama (rotasi deterministik atas bank, tanpa state).
    assert daily_fallback_quote(TODAY) == daily_fallback_quote(TODAY)
    # Seluruh hasil adalah anggota bank (dirotasi), bukan karangan.
    from app.services.quotes import _FALLBACK, _QUOTE_BANK

    bank = list(_QUOTE_BANK.values()) + [_FALLBACK]
    for offset in range(len(bank) + 1):
        assert daily_fallback_quote(TODAY + timedelta(days=offset)) in bank
