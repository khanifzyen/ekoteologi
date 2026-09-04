"""Test riwayat scan & kuota (Sprint 3): `GET /v1/scans`, `/categories`, `/quota`."""

import pytest
from redis.exceptions import RedisError

from app.core.deps import get_redis_dep
from app.main import app
from scripts.seed import seed
from tests.conftest import login_token, make_user

pytestmark = pytest.mark.asyncio(loop_scope="session")

PNG = b"\x89PNG\r\n\x1a\n" + b"riwayat-foto" * 8
PNG_LAIN = b"\x89PNG\r\n\x1a\n" + b"riwayat-foto-bedaa" * 8


async def _scan(client, token, data):
    return await client.post(
        "/v1/scan",
        files={"file": ("f.png", data, "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )


async def test_riwayat_butuh_auth(client):
    assert (await client.get("/v1/scans")).status_code == 401
    assert (await client.get("/v1/scans/quota")).status_code == 401


async def test_riwayat_kosong(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/scans", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == [] and body["total"] == 0


async def test_riwayat_terisi_urut_terbaru_dan_filter_kategori(client, member_user):
    await seed()
    token = await login_token(client, member_user.email, "password123")
    first = (await _scan(client, token, PNG)).json()
    second = (await _scan(client, token, PNG_LAIN)).json()

    resp = await client.get("/v1/scans", headers={"Authorization": f"Bearer {token}"})
    body = resp.json()
    assert body["total"] == 2 and len(body["items"]) == 2
    # Terbaru lebih dulu
    assert [i["id"] for i in body["items"]] == [second["id"], first["id"]]
    item = body["items"][0]
    assert item["item_name"] == second["item_name"]
    assert item["category"]["name"] == second["category"]["name"]
    assert item["points"] == second["points"]
    assert item["image_url"].startswith("/uploads/scans/")
    assert item["created_at"]

    # Filter kategori: scan kedua (terbaru) kategori apa pun → pastikan filter bekerja
    cat_id = first["category"]["id"]
    cat_lain_id = second["category"]["id"]
    if cat_id != cat_lain_id:
        filtered = await client.get(
            f"/v1/scans?category_id={cat_id}", headers={"Authorization": f"Bearer {token}"}
        )
        fbody = filtered.json()
        assert fbody["total"] == 1 and fbody["items"][0]["id"] == first["id"]

    # Riwayat milik user lain tidak bocor
    other = make_user(email="riwayat2@example.com")
    from app.db.session import get_session_factory

    async with get_session_factory()() as s:
        s.add(other)
        await s.commit()
    other_token = await login_token(client, other.email, "password123")
    other_resp = await client.get("/v1/scans", headers={"Authorization": f"Bearer {other_token}"})
    assert other_resp.json()["total"] == 0


async def test_riwayat_pagination(client, member_user):
    await seed()
    token = await login_token(client, member_user.email, "password123")
    for i in range(3):
        await _scan(client, token, PNG + bytes([i]))

    resp = await client.get(
        "/v1/scans?limit=2&offset=0", headers={"Authorization": f"Bearer {token}"}
    )
    body = resp.json()
    assert body["total"] == 3 and len(body["items"]) == 2
    first_page_ids = [i["id"] for i in body["items"]]

    page2 = await client.get(
        "/v1/scans?limit=2&offset=2", headers={"Authorization": f"Bearer {token}"}
    )
    body2 = page2.json()
    assert len(body2["items"]) == 1
    assert body2["items"][0]["id"] not in first_page_ids


async def test_daftar_kategori_seed(client, member_user):
    await seed()
    resp = await client.get("/v1/scans/categories")
    assert resp.status_code == 200
    cats = resp.json()
    names = {c["name"] for c in cats}
    assert {"Organik", "Plastik", "B3", "Residu"} <= names
    assert all("base_points" in c and "icon" in c for c in cats)


async def test_kuota_awal_dan_setelah_scan(client, member_user):
    await seed()
    token = await login_token(client, member_user.email, "password123")

    resp = await client.get("/v1/scans/quota", headers={"Authorization": f"Bearer {token}"})
    body = resp.json()
    assert body["used"] == 0 and body["remaining"] == body["limit"]
    assert body["resets_in_seconds"] > 0

    await _scan(client, token, PNG)
    await _scan(client, token, PNG_LAIN)
    body2 = (
        await client.get("/v1/scans/quota", headers={"Authorization": f"Bearer {token}"})
    ).json()
    assert body2["used"] == 2 and body2["remaining"] == body2["limit"] - 2


async def test_kuota_redis_mati_503(client, member_user):
    token = await login_token(client, member_user.email, "password123")

    class RedisMati:
        async def get(self, *a, **k):
            raise RedisError("down")

    async def redis_mati():
        return RedisMati()

    app.dependency_overrides[get_redis_dep] = redis_mati
    try:
        resp = await client.get("/v1/scans/quota", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.pop(get_redis_dep, None)
