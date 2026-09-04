"""Test adapter LLM (Sprint 2): mock deterministik, pabrik, provider OpenAI-compatible.

Provider asli TIDAK pernah dipanggil — OpenAI-compatible diuji lewat
`httpx.MockTransport` (parse, retry, fallback model, kegagalan total).
"""

import base64
import hashlib
import json

import httpx
import pytest

from app.core.config import get_settings
from app.schemas.scan import ScanLLMResult
from app.services.llm import (
    LLMError,
    MockProvider,
    OpenAICompatibleProvider,
    get_llm_provider,
)
from app.services.llm.base import parse_llm_content

pytestmark = pytest.mark.asyncio(loop_scope="session")

CATEGORIES = ["Organik", "Plastik", "Kertas", "Kaca", "Logam", "B3", "Residu"]
PNG = b"\x89PNG\r\n\x1a\n" + b"data"


def _png(seed: int) -> bytes:
    return PNG + bytes([seed]) * 16


def _completions_response(content: str, model: str) -> dict:
    return {
        "id": "chatcmpl-test",
        "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
    }


def _live_settings(monkeypatch, **overrides):
    """Aktifkan mode live di settings cache GLOBAL — wajib via monkeypatch agar
    otomatis dipulihkan; tanpa itu mode live bocor ke test lain (pollusi)."""
    for key, value in {
        "llm_mode": "live",
        "llm_api_key": "test-key",
        "llm_base_url": "https://llm.example.com/v4",
        "llm_model": "vision-primer",
        "llm_fallback_model": "",
        "llm_max_retries": 1,
        "llm_retry_backoff_seconds": 0,
        "llm_timeout_seconds": 5,
        **overrides,
    }.items():
        monkeypatch.setattr(get_settings(), key, value)
    return get_settings()


# ── MockProvider ──


async def test_mock_deterministik_per_hash_foto():
    first = await MockProvider().analyze(_png(1), "image/png", CATEGORIES)
    second = await MockProvider().analyze(_png(1), "image/png", CATEGORIES)
    assert first.result == second.result
    assert first.raw == second.raw


async def test_mock_variasi_item():
    results = set()
    for seed in range(24):
        response = await MockProvider().analyze(_png(seed), "image/png", CATEGORIES)
        results.add(response.result.item_name)
    assert len(results) > 1  # byte berbeda menghasilkan item berbeda


async def test_mock_hasil_valid_dan_meta():
    response = await MockProvider().analyze(_png(3), "image/png", CATEGORIES)
    assert isinstance(response.result, ScanLLMResult)
    assert response.result.category in CATEGORIES
    assert response.result.points > 0
    assert response.meta["provider"] == "mock"
    assert isinstance(response.meta["latency_ms"], int)
    assert response.meta["attempts"] == 1
    # llm_raw = payload JSON yang dikirim seolah oleh LLM (utk audit, PRD §5.3)
    assert response.raw["item_name"] == response.result.item_name


# ── parse & validasi schema ──


async def test_parse_menerima_json_dalam_code_fence():
    content = (
        '```json\n{"item_name": "Botol plastik", "category": "Plastik", '
        '"advice": "Buang ke tempat plastik.", "points": 5}\n```'
    )
    result = parse_llm_content(content, CATEGORIES)
    assert result.category == "Plastik"


async def test_parse_normalisasi_kategori_case_insensitive():
    payload = {
        "item_name": "Kulit pisang",
        "category": "organik",
        "advice": "Jadikan kompos.",
        "points": 3,
    }
    result = parse_llm_content(json.dumps(payload), CATEGORIES)
    assert result.category == "Organik"  # ejaan resmi dari daftar kategori


@pytest.mark.parametrize(
    "payload",
    [
        {"item_name": "X", "category": "Plastik", "advice": "Buang baik-baik ya.", "points": 5},
        {  # points di luar rentang
            "item_name": "Botol",
            "category": "Plastik",
            "advice": "Buang baik-baik ya.",
            "points": 500,
        },
        {  # kategori tak dikenal
            "item_name": "Botol",
            "category": "Nuklir",
            "advice": "Buang baik-baik ya.",
            "points": 5,
        },
        {  # advice terlalu pendek
            "item_name": "Botol",
            "category": "Plastik",
            "advice": "Ya",
            "points": 5,
        },
        {  # quote tanpa source
            "item_name": "Botol",
            "category": "Plastik",
            "advice": "Buang baik-baik ya.",
            "points": 5,
            "quote": {"text": "Ayat"},
        },
    ],
)
async def test_parse_menolak_respons_tidak_valid(payload):
    with pytest.raises(LLMError):
        parse_llm_content(json.dumps(payload), CATEGORIES)


async def test_parse_menolak_bukan_json():
    with pytest.raises(LLMError):
        parse_llm_content("Maaf, saya tidak bisa menganalisis foto ini.", CATEGORIES)


# ── pabrik provider ──


async def test_factory_default_mock(monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_mode", "mock")
    assert isinstance(get_llm_provider(), MockProvider)


async def test_factory_live_belum_konfigurasi_jatuh_ke_mock(monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_mode", "live")
    monkeypatch.setattr(get_settings(), "llm_api_key", "")
    assert isinstance(get_llm_provider(), MockProvider)  # biaya nol, tidak crash


async def test_factory_live_lengkap(monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_mode", "live")
    monkeypatch.setattr(get_settings(), "llm_api_key", "key")
    monkeypatch.setattr(get_settings(), "llm_base_url", "https://x")
    monkeypatch.setattr(get_settings(), "llm_model", "m")
    provider = get_llm_provider()
    assert isinstance(provider, OpenAICompatibleProvider)


# ── OpenAICompatibleProvider (via httpx.MockTransport — tanpa jaringan) ──


def _make_transport(responder) -> tuple[httpx.MockTransport, list[dict]]:
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return responder(request, len(calls))

    return httpx.MockTransport(handler), calls


async def test_live_sukses_parse_dan_meta(monkeypatch):
    settings = _live_settings(monkeypatch)
    content = json.dumps(
        {
            "item_name": "Botol plastik",
            "category": "Plastik",
            "advice": "Setor ke bank sampah.",
            "points": 5,
        }
    )
    transport, calls = _make_transport(
        lambda request, n: httpx.Response(200, json=_completions_response(content, "vision-primer"))
    )
    provider = OpenAICompatibleProvider(settings, transport=transport)

    response = await provider.analyze(_png(1), "image/png", CATEGORIES)

    assert response.result.item_name == "Botol plastik"
    assert response.meta["model"] == "vision-primer"
    assert response.meta["attempts"] == 1
    assert response.meta["fallback_used"] is False
    assert response.meta["tokens"]["total_tokens"] == 150
    # permintaan berisi gambar base64 + daftar kategori di prompt
    assert calls[0]["model"] == "vision-primer"
    image_part = calls[0]["messages"][1]["content"][0]["image_url"]["url"]
    assert image_part.startswith("data:image/png;base64,")
    assert base64.b64decode(image_part.split(",", 1)[1]) == _png(1)
    assert "Organik" in calls[0]["messages"][0]["content"]
    assert response.raw["model"] == "vision-primer"


async def test_live_respons_rusak_memicu_retry_lalu_sukses(monkeypatch):
    settings = _live_settings(monkeypatch)
    content = json.dumps(
        {
            "item_name": "Kulit pisang",
            "category": "Organik",
            "advice": "Jadikan kompos di rumah.",
            "points": 5,
        }
    )
    transport, calls = _make_transport(
        lambda request, n: (
            httpx.Response(200, json=_completions_response("bukan json {{", "vision-primer"))
            if n == 1
            else httpx.Response(200, json=_completions_response(content, "vision-primer"))
        )
    )
    provider = OpenAICompatibleProvider(settings, transport=transport)

    response = await provider.analyze(_png(2), "image/png", CATEGORIES)
    assert response.result.category == "Organik"
    assert response.meta["attempts"] == 2


async def test_live_primer_gagal_fallback_ke_model_kedua(monkeypatch):
    settings = _live_settings(monkeypatch, llm_fallback_model="vision-cadangan")
    content = json.dumps(
        {
            "item_name": "Baterai bekas",
            "category": "B3",
            "advice": "Serahkan ke titik pengumpulan B3.",
            "points": 10,
        }
    )
    transport, calls = _make_transport(
        lambda request, n: (
            httpx.Response(500, text="server error")
            if json.loads(request.content)["model"] == "vision-primer"
            else httpx.Response(200, json=_completions_response(content, "vision-cadangan"))
        )
    )
    provider = OpenAICompatibleProvider(settings, transport=transport)

    response = await provider.analyze(_png(4), "image/png", CATEGORIES)
    assert response.result.category == "B3"
    assert response.meta["fallback_used"] is True
    assert response.meta["model"] == "vision-cadangan"
    used_models = [c["model"] for c in calls]
    assert used_models.count("vision-primer") == 2  # 1 + 1 retry
    assert used_models[-1] == "vision-cadangan"


async def test_live_semua_model_gagal_memicu_llm_error(monkeypatch):
    settings = _live_settings(monkeypatch, llm_fallback_model="vision-cadangan")
    transport, _ = _make_transport(lambda request, n: httpx.Response(429, text="rate limited"))
    provider = OpenAICompatibleProvider(settings, transport=transport)

    with pytest.raises(LLMError):
        await provider.analyze(_png(5), "image/png", CATEGORIES)


async def test_live_kategori_tidak_kenal_diretry_dan_gagal_total(monkeypatch):
    settings = _live_settings(monkeypatch)
    bad = json.dumps(
        {
            "item_name": "Reaktor",
            "category": "Nuklir",
            "advice": "Hubungi petugas khusus.",
            "points": 50,
        }
    )
    transport, _ = _make_transport(
        lambda request, n: httpx.Response(200, json=_completions_response(bad, "vision-primer"))
    )
    provider = OpenAICompatibleProvider(settings, transport=transport)

    with pytest.raises(LLMError):
        await provider.analyze(_png(6), "image/png", CATEGORIES)


async def test_live_tanpa_fallback_langsung_llm_error(monkeypatch):
    settings = _live_settings(monkeypatch)
    transport, _ = _make_transport(lambda request, n: httpx.Response(500, text="boom"))
    provider = OpenAICompatibleProvider(settings, transport=transport)

    with pytest.raises(LLMError):
        await provider.analyze(_png(7), "image/png", CATEGORIES)


async def test_digest_konsisten():
    from app.services.scan_cache import image_digest

    assert image_digest(b"abc") == hashlib.sha256(b"abc").hexdigest()
    assert image_digest(b"abc") == image_digest(b"abc")
    assert image_digest(b"abc") != image_digest(b"abd")
