"""Pabrik provider LLM (Sprint 2) — pemilihan via env `LLM_MODE`.

- `LLM_MODE=mock` (default) → `MockProvider`: biaya nol saat development/test
  (implementation-plan §4 story "LLM provider adapter + mock mode").
- `LLM_MODE=live` → `OpenAICompatibleProvider`; bila konfigurasi (api key /
  base url / model) belum lengkap, otomatis jatuh kembali ke mock dengan
  warning agar dev lokal tetap bisa jalan tanpa biaya.
"""

import logging

from app.core.config import get_settings
from app.services.llm.base import LLMError, LLMProvider, LLMResponse
from app.services.llm.mock import MockProvider
from app.services.llm.openai_compat import OpenAICompatibleProvider

__all__ = [
    "LLMError",
    "LLMProvider",
    "LLMResponse",
    "MockProvider",
    "OpenAICompatibleProvider",
    "get_llm_provider",
]

logger = logging.getLogger("ekoteologi.llm")


def get_llm_provider() -> LLMProvider:
    """Kembalikan provider aktif sesuai env; dipanggil per-request (mudah di-mock test)."""
    settings = get_settings()
    if settings.llm_mode == "live":
        if settings.llm_api_key and settings.llm_base_url and settings.llm_model:
            return OpenAICompatibleProvider(settings)
        logger.warning(
            "LLM_MODE=live tetapi LLM_API_KEY/LLM_BASE_URL/LLM_MODEL belum lengkap — "
            "memakai mock provider (biaya nol)."
        )
    elif settings.llm_mode != "mock":
        logger.warning("LLM_MODE='%s' tidak dikenal — memakai mock provider.", settings.llm_mode)
    return MockProvider()
