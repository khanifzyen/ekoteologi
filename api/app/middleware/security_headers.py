"""Middleware security header (Sprint 8 — hardening).

Menambahkan header proteksi dasar pada **setiap** respons API (termasuk
error 4xx/5xx dan file statis `/uploads`):

- `X-Content-Type-Options: nosniff` — browser tidak menebak MIME (upload).
- `X-Frame-Options: DENY` — API & berkas upload tidak boleh di-frame.
- `Referrer-Policy: strict-origin-when-cross-origin` — bocor URL minim.
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` —
  API JSON tidak memuat aktif; berlaku juga bila respons dinavigasi.
- `Permissions-Policy: camera=(self), microphone=(), geolocation=()` —
  kamera hanya untuk app sendiri (deklarasi izin Play Store — PRD §9).
- `Strict-Transport-Security` **hanya** saat `environment=prod` (API di-
  layani TLS; di dev lokal HTTP murni akan memblokir request).

Middleware sengaja tidak menyentuh body — satu loop header, nol overhead
berarti. Teruji di `tests/test_security_headers.py`.
"""

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.config import get_settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
        )
        response.headers.setdefault(
            "Permissions-Policy", "camera=(self), microphone=(), geolocation=()"
        )
        if get_settings().environment == "prod":
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response
