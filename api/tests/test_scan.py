"""Test endpoint POST /v1/scan end-to-end (Sprint 2, mock mode — tanpa LLM asli).

Mencakup: auth, validasi file, simpan `llm_raw`/`llm_meta` (PRD §5.3), cache Redis
(hit/miss), kuota harian + fail-closed, guard foto duplikat, dan integrasi ledger.
"""

from pathlib import Path

import pytest
from redis.exceptions import RedisError
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.deps import get_redis_dep
from app.core.redis import get_redis
from app.main import app
from app.models import AnalyticsEvent, PointTransaction, Scan, WasteCategory
from app.services.llm import LLMError, MockProvider
from app.services.quotes import quote_for_category
from app.services.scan_cache import cache_stats, image_digest
from scripts.seed import seed
from tests.conftest import login_token, make_user

pytestmark = pytest.mark.asyncio(loop_scope="session")

PNG = b"\x89PNG\r\n\x1a\n" + b"contoh-data-foto" * 8
PNG_LAIN = b"\x89PNG\r\n\x1a\n" + b"foto-yang-berbeda" * 8


async def _scan(client, token, data=PNG, filename="foto.png"):
    return await client.post(
        "/v1/scan",
        files={"file": (filename, data, "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )


async def test_scan_butuh_auth(client):
    resp = await client.post("/v1/scan", files={"file": ("f.png", PNG, "image/png")})
    assert resp.status_code == 401


async def test_scan_happy_path_tersimpan_lengkap(client, member_user, db_session):
    await seed()
    token = await login_token(client, member_user.email, "password123")

    resp = await _scan(client, token)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    kategori = await db_session.get(WasteCategory, body["category"]["id"])
    assert kategori is not None
    assert body["item_name"]
    assert body["category"]["name"] == kategori.name
    assert body["advice"]
    assert body["quote"]["text"] and body["quote"]["source"]
    assert body["cached"] is False and body["duplicate"] is False
    # poin = min(usulan LLM, base_points kategori) — mock selalu pas dgn base_points
    assert body["points"] == kategori.base_points
    assert body["points_total"] == kategori.base_points
    assert body["image_url"].startswith("/uploads/scans/")

    # Baris scans: llm_raw & llm_meta terekam (PRD §5.3)
    scan = await db_session.get(Scan, body["id"])
    assert scan is not None
    assert scan.llm_raw is not None and scan.llm_meta is not None
    assert scan.llm_meta["provider"] == "mock"
    assert scan.llm_meta["cached"] is False
    assert scan.category_id == kategori.id
    assert scan.quote == {"text": body["quote"]["text"], "source": body["quote"]["source"]}

    # Foto tersimpan di UPLOAD_DIR
    path = Path(get_settings().upload_dir) / body["image_url"].removeprefix("/uploads/")
    assert path.exists() and path.read_bytes() == PNG

    # Ledger append-only + cache poin user tersinkron
    ledger = (
        await db_session.scalars(
            select(PointTransaction).where(PointTransaction.user_id == member_user.id)
        )
    ).all()
    assert len(ledger) == 1
    assert ledger[0].source == "scan"
    assert ledger[0].ref_id == scan.id
    assert ledger[0].amount == kategori.base_points
    await db_session.refresh(member_user)
    assert member_user.points == kategori.base_points


async def test_scan_cache_hit_foto_sama_user_berbeda(client, member_user, db_session):
    """Foto byte sama → panggilan LLM hanya sekali; user berbeda tetap dapat poin."""
    await seed()
    other = make_user(email="scanner2@example.com")
    db_session.add(other)
    await db_session.commit()

    token1 = await login_token(client, member_user.email, "password123")
    token2 = await login_token(client, other.email, "password123")

    first = await _scan(client, token1)
    second = await _scan(client, token2)
    assert first.status_code == 200 and second.status_code == 200
    assert second.json()["cached"] is True
    assert second.json()["item_name"] == first.json()["item_name"]
    assert second.json()["points"] == first.json()["points"]  # bukan duplikat utk user beda

    scan2 = await db_session.get(Scan, second.json()["id"])
    assert scan2.llm_meta["cached"] is True

    stats = await cache_stats(get_redis())
    assert stats["miss"] == 1 and stats["hit"] == 1  # hit rate = 50% di sesi test ini


async def test_scan_foto_duplikat_user_sama_poin_nol(client, member_user, db_session):
    """Anti poin-farming (PRD §9): foto sama, user sama, hari sama → poin 0."""
    await seed()
    token = await login_token(client, member_user.email, "password123")

    first = await _scan(client, token)
    second = await _scan(client, token)
    assert first.status_code == 200 and second.status_code == 200
    assert second.json()["duplicate"] is True
    assert second.json()["points"] == 0
    assert second.json()["points_total"] == first.json()["points"]  # tidak bertambah

    ledger_count = await db_session.scalar(
        select(func.count())
        .select_from(PointTransaction)
        .where(PointTransaction.user_id == member_user.id)
    )
    assert ledger_count == 1  # hanya scan pertama yang masuk ledger


async def test_scan_kuota_harian_habis(client, member_user, monkeypatch):
    await seed()
    monkeypatch.setattr(get_settings(), "scan_daily_limit", 2)
    token = await login_token(client, member_user.email, "password123")

    assert (await _scan(client, token)).status_code == 200
    assert (await _scan(client, token, PNG_LAIN)).status_code == 200
    resp = await _scan(client, token)
    assert resp.status_code == 429
    assert "Kuota scan harian habis" in resp.json()["detail"]
    assert int(resp.headers["Retry-After"]) > 0


async def test_scan_redis_mati_fail_closed(client, member_user):
    """Redis mati → scan DITOLAK 503 (pelindung budget LLM), berbeda dgn login fail-open."""
    await seed()
    token = await login_token(client, member_user.email, "password123")

    class RedisMati:
        async def incr(self, *a, **k):
            raise RedisError("down")

    async def redis_mati():
        return RedisMati()

    app.dependency_overrides[get_redis_dep] = redis_mati
    try:
        resp = await _scan(client, token)
        assert resp.status_code == 503
        assert "tidak tersedia" in resp.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_redis_dep, None)


async def test_scan_file_kosong(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await _scan(client, token, data=b"")
    assert resp.status_code == 400


async def test_scan_format_tidak_didukung(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await _scan(client, token, data=b"inisebuahfileteks biasa")
    assert resp.status_code == 400


async def test_scan_kegedean_ukuran(client, member_user, monkeypatch):
    monkeypatch.setattr(get_settings(), "scan_image_max_mb", 0)
    token = await login_token(client, member_user.email, "password123")
    resp = await _scan(client, token)
    assert resp.status_code == 413


class ProviderGagal:
    async def analyze(self, *a, **k):
        raise LLMError("provider down setelah retry & fallback")


async def test_scan_llm_gagal_502_tidak_tersimpan(client, member_user, db_session, monkeypatch):
    await seed()
    monkeypatch.setattr("app.api.scan.get_llm_provider", lambda: ProviderGagal())
    token = await login_token(client, member_user.email, "password123")

    resp = await _scan(client, token)
    assert resp.status_code == 502
    assert "gangguan" in resp.json()["detail"]

    count = await db_session.scalar(select(func.count()).select_from(Scan))
    assert count == 0
    await db_session.refresh(member_user)
    assert member_user.points == 0


async def test_scan_digest_selalu_sama_untuk_foto_sama():
    assert image_digest(PNG) == image_digest(PNG)


async def test_scan_pertama_event_aktivasi_tercatat_sekali(client, member_user, db_session):
    """Gate Sprint 3 (PRD §8): event `scan_pertama` hanya pada scan PERTAMA user."""
    await seed()
    token = await login_token(client, member_user.email, "password123")

    assert (await _scan(client, token)).status_code == 200
    assert (await _scan(client, token, PNG_LAIN)).status_code == 200

    events = (
        await db_session.scalars(
            select(AnalyticsEvent).where(AnalyticsEvent.name == "scan_pertama")
        )
    ).all()
    assert len(events) == 1
    assert events[0].user_id == member_user.id
    assert events[0].payload["points"] >= 0 and "category" in events[0].payload


async def test_quote_bank_meliputi_kategori_seed():
    for nama in ["Organik", "Plastik", "Kertas", "Kaca", "Logam", "B3", "Residu", "Lainnya"]:
        quote = quote_for_category(nama)
        assert quote.text and quote.source


async def test_mock_provider_terdaftar():
    assert MockProvider.provider_name == "mock"
