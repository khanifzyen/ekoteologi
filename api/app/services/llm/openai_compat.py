"""Provider LLM vision OpenAI-compatible (Sprint 2) — mis. GLM-4.5V / GLM-4.6V.

Model, base URL, dan API key semuanya dari env (PRD §4 — tidak pernah hardcode):
`LLM_BASE_URL` (mis. https://open.bigmodel.cn/api/paas/v4), `LLM_API_KEY`,
`LLM_MODEL`, `LLM_FALLBACK_MODEL`. Retry per model, lalu fallback model kedua
(timeouts + 429/5xx + respons tidak valid), sesuai strategi implementation-plan §5.1.
"""

import base64
import json
import logging
import time

import httpx

from app.core.config import Settings
from app.services.llm.base import (
    LLMError,
    LLMResponse,
    build_messages,
    parse_llm_content,
    run_with_retries,
)

logger = logging.getLogger("ekoteologi.llm")


class OpenAICompatibleProvider:
    provider_name = "openai-compatible"

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self._settings = settings
        self._transport = transport  # injeksi utk test (httpx.MockTransport)

    async def analyze(self, image: bytes, mime: str, categories: list[str]) -> LLMResponse:
        started = time.perf_counter()
        attempts = [0]
        try:
            response = await run_with_retries(
                lambda model: self._call_model(model, image, mime, categories),
                model=self._settings.llm_model,
                max_retries=self._settings.llm_max_retries,
                backoff_seconds=self._settings.llm_retry_backoff_seconds,
                attempts_counter=attempts,
            )
            fallback_used = False
        except LLMError as primary_error:
            if not self._settings.llm_fallback_model:
                raise
            logger.warning("Model primer gagal total — beralih ke fallback: %s", primary_error)
            try:
                response = await run_with_retries(
                    lambda model: self._call_model(model, image, mime, categories),
                    model=self._settings.llm_fallback_model,
                    max_retries=self._settings.llm_max_retries,
                    backoff_seconds=self._settings.llm_retry_backoff_seconds,
                    attempts_counter=attempts,
                )
            except LLMError as fallback_error:
                raise LLMError(
                    f"Model primer & fallback gagal: {primary_error}; {fallback_error}"
                ) from None
            fallback_used = True

        response.meta.update(
            {
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "attempts": attempts[0],
                "fallback_used": fallback_used,
            }
        )
        return response

    async def _call_model(self, model: str, image: bytes, mime: str, categories: list[str]):
        messages = build_messages(base64.b64encode(image).decode("ascii"), mime, categories)
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 500,
        }
        headers = {"Authorization": f"Bearer {self._settings.llm_api_key}"}
        timeout = httpx.Timeout(self._settings.llm_timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout, transport=self._transport) as client:
            try:
                resp = await client.post(
                    f"{self._settings.llm_base_url.rstrip('/')}/chat/completions",
                    json=payload,
                    headers=headers,
                )
            except httpx.HTTPError as exc:
                raise LLMError(f"Permintaan ke provider gagal: {type(exc).__name__}") from None

        if resp.status_code >= 400:
            # 429/5xx layak di-retry; 4xx lain (mis. 401) juga dianggap gagal model ini.
            raise LLMError(f"Provider merespons {resp.status_code}")

        try:
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"Bentuk respons provider tidak dikenal: {exc}") from None

        result = parse_llm_content(content, categories)
        return LLMResponse(
            result=result,
            raw=data,  # respon mentah penuh utk `scans.llm_raw` (audit & debug)
            meta={
                "provider": self.provider_name,
                "model": model,
                "latency_ms": 0,  # diisi ulang setelah seluruh percobaan
                "tokens": data.get("usage"),
                "attempts": 0,
                "fallback_used": False,
            },
        )
