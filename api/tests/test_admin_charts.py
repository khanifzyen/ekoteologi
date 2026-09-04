"""Test dashboard admin Sprint 4: biaya LLM pada KPI + `GET /v1/admin/charts`."""

import pytest

from app.models import Scan
from scripts.seed import seed
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")

PNG = b"\x89PNG\r\n\x1a\n" + b"chart-foto-scan" * 8


async def _scan(client, token):
    return await client.post(
        "/v1/scan",
        files={"file": ("f.png", PNG, "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )


async def test_charts_butuh_auth_dan_role(client, member_user):
    assert (await client.get("/v1/admin/charts")).status_code == 401
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/admin/charts", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


async def test_kpi_menyertakan_biaya_llm(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.get("/v1/admin/kpi", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    llm = resp.json()["llm"]
    # Mock mode tidak memakai token → biaya Rp0 meski rate env diset.
    assert llm["tokens_month"] == 0
    assert llm["cost_month"] == 0
    assert llm["budget_monthly"] is None  # default env = 0 (belum ditetapkan)


async def test_kpi_biaya_llm_dihitung_dari_token_non_cache(client, admin_user, db_session):
    """Dua baris scan: asli (500 token) + cache (token diabaikan) → 500 token."""

    async def add_scan(tokens: int | None, cached: bool):
        meta: dict = {"model": "test-model", "tokens": None}
        if tokens is not None:
            meta["tokens"] = {
                "prompt_tokens": tokens - 50,
                "completion_tokens": 50,
                "total_tokens": tokens,
            }
        meta["cached"] = cached
        db_session.add(Scan(item_name="Botol", llm_meta=meta, points=5))
        await db_session.commit()

    await add_scan(500, cached=False)
    await add_scan(999, cached=True)  # meta panggilan asli — tidak boleh dihitung ganda

    token = await login_token(client, admin_user.email, "password123")
    resp = await client.get("/v1/admin/kpi", headers={"Authorization": f"Bearer {token}"})
    llm = resp.json()["llm"]
    assert llm["tokens_month"] == 500
    # Rate env default 0 → biaya 0; rumus diuji lewat override settings di test lain.
    assert llm["cost_month"] == 0


async def test_kpi_biaya_llm_mengikuti_rate_env(client, admin_user, db_session, monkeypatch):
    """Rumus: token/1000 × LLM_COST_PER_1K_TOKENS (env, tanpa hardcode)."""
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "llm_cost_per_1k_tokens", 1200.0)
    monkeypatch.setattr(get_settings(), "llm_budget_monthly", 150_000.0)

    db_session.add(
        Scan(
            item_name="Botol",
            llm_meta={
                "model": "test-model",
                "cached": False,
                "tokens": {"prompt_tokens": 300, "completion_tokens": 200, "total_tokens": 2000},
            },
            points=5,
        )
    )
    await db_session.commit()

    token = await login_token(client, admin_user.email, "password123")
    resp = await client.get("/v1/admin/kpi", headers={"Authorization": f"Bearer {token}"})
    llm = resp.json()["llm"]
    assert llm["tokens_month"] == 2000
    assert llm["cost_month"] == 2400.0  # 2000/1000 × 1200
    assert llm["budget_monthly"] == 150_000.0


async def test_charts_data_dari_scan_nyata(client, admin_user):
    await seed()
    token = await login_token(client, admin_user.email, "password123")
    scan_resp = await _scan(client, token)
    assert scan_resp.status_code == 200

    resp = await client.get("/v1/admin/charts", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()

    # Garis harian: 14 hari terakhir (default), hari ini berisi 1 scan.
    assert body["days"] == 14
    assert len(body["daily"]) == 14
    assert sum(d["count"] for d in body["daily"]) == 1
    assert body["daily"][-1]["count"] == 1

    # Batang kategori: 1 scan → 1 kategori 100%.
    assert body["categories_total"] == 1
    assert len(body["categories"]) == 1
    top = body["categories"][0]
    assert top["percentage"] == 100.0 and top["count"] == 1
    assert top["name"] in {"Organik", "Plastik", "Kertas", "Kaca", "Logam", "B3", "Residu"}


async def test_charts_tanpa_data_nol_rapi(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.get(
        "/v1/admin/charts", params={"days": 7}, headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["days"] == 7 and len(body["daily"]) == 7
    assert all(d["count"] == 0 for d in body["daily"])
    assert body["categories"] == [] and body["categories_total"] == 0
