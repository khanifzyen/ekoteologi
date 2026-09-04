"""Kontrak adapter LLM + prompt engineering + validator respons (Sprint 2).

Semua pemanggilan LLM melewati lapisan ini (PRD §4: app tidak pernah memanggil
LLM langsung). Provider konkret: `mock.MockProvider` (dev/test, biaya nol) dan
`openai_compat.OpenAICompatibleProvider` (provider vision OpenAI-compatible).

Retry/fallback/timeout (story Sprint 2):
- per model: hingga `llm_max_retries` percobaan ulang (timeout, HTTP 429/5xx,
  atau respons tidak lolos validasi schema/kategori);
- habis di model primer → pindah ke `LLM_FALLBACK_MODEL` (bila diisi);
- seluruh model gagal → `LLMError` → endpoint merespons 502/503, tidak tersimpan.
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from pydantic import ValidationError

from app.schemas.scan import ScanLLMResult

logger = logging.getLogger("ekoteologi.llm")


class LLMError(Exception):
    """Semua jalur provider gagal (setelah retry + fallback) atau respons tak valid."""


@dataclass
class LLMResponse:
    """Hasil analisis yang sudah lolos validasi + bahan `llm_raw`/`llm_meta` (PRD §5.3)."""

    result: ScanLLMResult
    raw: Any  # respon mentah provider — disimpan apa adanya di `scans.llm_raw`
    meta: dict[str, Any] = field(default_factory=dict)
    # meta minimal: {provider, model, latency_ms, tokens, attempts, fallback_used}


class LLMProvider(Protocol):
    async def analyze(self, image: bytes, mime: str, categories: list[str]) -> LLMResponse:
        """Analisis foto → hasil tervalidasi. Raise `LLMError` bila gagal total."""
        ...


# ── Prompt engineering (Bahasa Indonesia, output JSON ketat) ──

SYSTEM_PROMPT = """Kamu adalah asisten pemilah sampah untuk aplikasi edukasi lingkungan \
Ekoteologi AR. Tugasmu: mengenali satu objek sampah utama pada foto lalu menjawab HANYA \
dengan satu objek JSON valid (tanpa penjelasan lain) dengan bentuk:

{"item_name": "...", "category": "...", "advice": "...", \
"quote": {"text": "...", "source": "..."}, "points": 0}

Aturan:
1. `item_name`: nama objek spesifik dalam Bahasa Indonesia (maks 100 karakter).
2. `category`: HARUS persis salah satu dari daftar berikut: __CATEGORIES__.
3. `advice`: 1-3 kalimat saran pembuangan/pengolahan yang benar dan aman (Bahasa Indonesia).
4. `quote`: kutipan ayat Al-Qur'an atau hadis singkat yang relevan dengan menjaga kelestarian
   bumi/kebersihan, beserta sumbernya (mis. "QS Ar-Rum: 41" atau "HR Bukhari no. 2320").
   Jika tidak yakin, isi dengan {"text": "", "source": ""} — aplikasi akan memakai bank kutipan
   terkurasi. JANGAN mengarang sumber.
5. `points`: angka bulatan 0-100 yang mencerminkan manfaat memilah objek ini (B3/daur ulang
   bernilai lebih tinggi, residu rendah).
Jawab HANYA JSON. Tanpa markdown, tanpa teks lain."""


def build_messages(image_b64: str, mime: str, categories: list[str]) -> list[dict[str, Any]]:
    """Pesan chat-completions untuk provider vision OpenAI-compatible."""
    # .replace() (bukan .format()) karena prompt memuat kurung kurawal JSON literal.
    system = SYSTEM_PROMPT.replace("__CATEGORIES__", ", ".join(categories))
    return [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{image_b64}"},
                },
                {"type": "text", "text": "Apa sampah pada foto ini? Jawab hanya JSON."},
            ],
        },
    ]


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$")


def parse_llm_content(content: str, categories: list[str]) -> ScanLLMResult:
    """Parse teks balasan LLM (bisa dibungkus code fence) → hasil tervalidasi.

    Melempar `LLMError` bila bukan JSON valid, schema tidak lolos, atau kategori
    di luar daftar kategori yang diizinkan (nama kategori dicocokkan case-insensitive).
    """
    text = _FENCE_RE.sub("", content.strip()).strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LLMError(f"Respons LLM bukan JSON valid: {exc}") from None
    if not isinstance(payload, dict):
        raise LLMError("Respons LLM bukan objek JSON.")

    try:
        result = ScanLLMResult.model_validate(payload)
    except ValidationError as exc:
        raise LLMError(f"Respons LLM tidak lolos schema: {exc.error_count()} kesalahan") from exc

    allowed = {c.casefold(): c for c in categories}
    if result.category.casefold() not in allowed:
        raise LLMError(f"Kategori '{result.category}' tidak dikenal.")
    # Normalisasi ke ejaan resmi kategori (mis. "plastik" → "Plastik").
    result.category = allowed[result.category.casefold()]
    return result


async def run_with_retries(
    fn,
    *,
    model: str,
    max_retries: int,
    backoff_seconds: float,
    attempts_counter: list[int],
) -> LLMResponse:
    """Jalankan `fn(model)` dgn retry; kembalikan respons atau raise `LLMError` terakhir."""
    last_error: Exception | None = None
    for attempt in range(max_retries + 1):
        attempts_counter[0] += 1
        try:
            return await fn(model)
        except LLMError as exc:
            last_error = exc
            logger.warning("LLM gagal (model=%s, percobaan=%d): %s", model, attempt + 1, exc)
            if attempt < max_retries and backoff_seconds > 0:
                await asyncio.sleep(backoff_seconds * (attempt + 1))
    assert last_error is not None
    raise last_error
