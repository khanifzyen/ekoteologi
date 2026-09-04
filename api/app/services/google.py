"""Verifikasi ID token Google untuk Sign-In (Sprint 1).

App mobile mengirim ID token dari Google Sign-In native; API memverifikasi via
endpoint `tokeninfo` Google lalu men-upsert user. `aud` dicocokkan dengan
`GOOGLE_CLIENT_ID` (Web Client ID dari Google Cloud Console — prasyarat akun,
implementation-plan §2.2).
"""

import time

import httpx

from app.core.config import get_settings

TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
ALLOWED_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class GoogleAuthError(Exception):
    """Gagal verifikasi; `status_code` dipakai endpoint untuk respons HTTP."""

    def __init__(self, message: str, status_code: int = 401):
        super().__init__(message)
        self.status_code = status_code


async def fetch_tokeninfo(id_token: str) -> dict:
    """Panggil endpoint tokeninfo Google. Dipisah agar mudah di-mock di test."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(TOKENINFO_URL, params={"id_token": id_token})
    except httpx.HTTPError:
        raise GoogleAuthError(
            "Layanan Google tidak dapat dihubungi. Coba lagi nanti.", status_code=503
        ) from None
    if resp.status_code != 200:
        # tokeninfo mengembalikan 400 utk token tidak valid/kedaluwarsa.
        raise GoogleAuthError("Sesi Google tidak valid atau kedaluwarsa.")
    return resp.json()


async def verify_google_id_token(id_token: str) -> dict:
    """Kembalikan {sub, email, name, picture} bila token valid untuk aplikasi ini."""
    settings = get_settings()
    if not settings.google_client_id:
        raise GoogleAuthError(
            "Google Sign-In belum dikonfigurasi pada server (GOOGLE_CLIENT_ID kosong).",
            status_code=503,
        )

    info = await fetch_tokeninfo(id_token)

    if info.get("aud") != settings.google_client_id:
        raise GoogleAuthError("Token Google bukan untuk aplikasi ini.")
    if info.get("iss") not in ALLOWED_ISSUERS:
        raise GoogleAuthError("Token Google tidak berasal dari penerbit resmi.")
    try:
        if int(info.get("exp", 0)) < int(time.time()):
            raise GoogleAuthError("Sesi Google sudah berakhir. Coba masuk lagi.")
    except ValueError:
        raise GoogleAuthError("Token Google tidak valid.") from None
    if str(info.get("email_verified", "")).lower() != "true":
        raise GoogleAuthError("Email Google Anda belum terverifikasi.")
    if not info.get("email") or not info.get("sub"):
        raise GoogleAuthError("Token Google tidak memuat identitas email.")

    return {
        "sub": info["sub"],
        "email": str(info["email"]).lower(),
        "name": info.get("name") or info["email"].split("@")[0],
        "picture": info.get("picture"),
    }
