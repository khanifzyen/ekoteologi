"""Integrasi Sentry (Sprint 8) — opsional penuh via env.

Sesuai story hardening: "Sentry" disiapkan strukturnya, tetapi **tanpa DSN
tidak aktif sama sekali** (nol dependensi runtime saat dev/test — item
terbuka "Sentry project" plan §2.2 belum ada kredensialnya). Cukup set
`SENTRY_DSN` (dan opsional `SENTRY_TRACES_SAMPLE_RATE`) di staging/prod
tanpa mengubah kode.

`before_send` membuang event `HTTPException` 4xx/503 yang memang perilaku
API (rate limit, validasi, auth, Redis mati terdegradasi) supaya kuota
Sentry dipakai untuk error sungguhan (5xx / tak terduga).
"""

import logging

from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import Settings

logger = logging.getLogger("ekoteologi.sentry")

# Status code yang TIDAK dikirim ke Sentry (perilaku API yang disengaja).
_IGNORED_STATUS = {400, 401, 403, 404, 409, 413, 422, 429, 503}


def _before_send(event: dict, hint: dict) -> dict | None:  # noqa: ANN001
    """Saring event: HTTPException yang disengaja tidak perlu dilaporkan."""
    exc_info = hint.get("exc_info") if isinstance(hint, dict) else None
    if exc_info:
        exc = exc_info[1]
        if isinstance(exc, StarletteHTTPException) and exc.status_code in _IGNORED_STATUS:
            return None
    return event


def init_sentry(settings: Settings) -> bool:
    """Inisialisasi Sentry bila `sentry_dsn` diisi. Return True bila aktif.

    Gagal init (DSN tidak valid, dsb.) tidak pernah boleh menumbangkan
    aplikasi — cukup warning log, API tetap jalan tanpa Sentry.
    """
    if not settings.sentry_dsn:
        return False
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.environment,
            traces_sample_rate=settings.sentry_traces_sample_rate,
            send_default_pii=False,  # PRD §9 — PII (nama/email) tidak dikirim
            before_send=_before_send,
        )
    except Exception:  # noqa: BLE001 — observability tidak boleh merusak app
        logger.warning("Gagal inisialisasi Sentry — berjalan tanpa Sentry.", exc_info=True)
        return False
    logger.info(
        "Sentry aktif (environment=%s, traces=%.2f)",
        settings.environment,
        settings.sentry_traces_sample_rate,
    )
    return True
