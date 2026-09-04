"""MockProvider — LLM palsu deterministik utk development & test (biaya nol).

Dipakai otomatis saat `LLM_MODE=mock` (default) atau saat konfigurasi live belum
lengkap. Pemilihan item deterministik dari hash byte foto sehingga:
- foto yang sama → hasil yang sama → cache Redis bisa teruji end-to-end;
- byte berbeda → item berbeda (bergilir) → variasi kategori teruji tanpa DB acak.
"""

import hashlib
import json
import time
from typing import Any

from app.schemas.scan import Quote
from app.services.llm.base import LLMResponse, parse_llm_content
from app.services.quotes import quote_for_category

# Item mock mencerminkan seed `waste_categories` (points = base_points seed).
_MOCK_ITEMS: list[dict[str, Any]] = [
    {
        "item_name": "Botol plastik bekas air mineral",
        "category": "Plastik",
        "advice": (
            "Kosongkan, bilas, dan penyetek labelnya lalu buang ke tempat sampah plastik "
            "atau setor ke bank sampah agar didaur ulang."
        ),
        "points": 5,
    },
    {
        "item_name": "Kulit pisang",
        "category": "Organik",
        "advice": (
            "Masukkan ke tempat sampah organik; lebih baik lagi dijadikan kompos atau "
            "pupuk fermentasi di rumah."
        ),
        "points": 5,
    },
    {
        "item_name": "Kardus bekas",
        "category": "Kertas",
        "advice": (
            "Lipat rapi agar hemat tempat lalu buang di tempat sampah kertas atau jual ke "
            "pemulung/bank sampah."
        ),
        "points": 4,
    },
    {
        "item_name": "Botol kaca bersisa saus",
        "category": "Kaca",
        "advice": (
            "Bilas hingga bersih lalu buang pada tempat sampah kaca; kaca utuh bisa "
            "digunakan ulang sebagai wadah."
        ),
        "points": 4,
    },
    {
        "item_name": "Kaleng aluminium bekas minuman",
        "category": "Logam",
        "advice": (
            "Bilas dan remas kalengnya, lalu setorkan ke bank sampah — aluminium sangat "
            "layak didaur ulang."
        ),
        "points": 5,
    },
    {
        "item_name": "Baterai bekas",
        "category": "B3",
        "advice": (
            "Jangan dibuang ke sampah biasa; kumpulkan dan serahkan ke titik pengumpulan "
            "B3 (mis. dropbox gerai ritel) agar tidak mencemari tanah dan air."
        ),
        "points": 10,
    },
    {
        "item_name": "Popok sekali pakai",
        "category": "Residu",
        "advice": (
            "Buang ke tempat sampah residu yang tertutup; popok tidak dapat didaur ulang "
            "sementara ini."
        ),
        "points": 2,
    },
]


class MockProvider:
    """Implementasi `LLMProvider` tanpa jaringan — seolah LLM vision sungguhan."""

    provider_name = "mock"

    async def analyze(self, image: bytes, mime: str, categories: list[str]) -> LLMResponse:
        started = time.perf_counter()
        digest = hashlib.sha256(image).hexdigest()
        item = _MOCK_ITEMS[int(digest, 16) % len(_MOCK_ITEMS)]

        quote: Quote = quote_for_category(item["category"])
        payload = {
            "item_name": item["item_name"],
            "category": item["category"],
            "advice": item["advice"],
            "quote": {"text": quote.text, "source": quote.source},
            "points": item["points"],
        }
        result = parse_llm_content(json.dumps(payload), categories)

        latency_ms = int((time.perf_counter() - started) * 1000)
        return LLMResponse(
            result=result,
            raw=payload,
            meta={
                "provider": self.provider_name,
                "model": "mock",
                "latency_ms": latency_ms,
                "tokens": None,
                "attempts": 1,
                "fallback_used": False,
            },
        )
