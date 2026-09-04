"""Konfigurasi aplikasi via environment (12-factor).

Semua nilai bisa dioverride lewat env / file `.env` (lihat `.env.example`).
Port lokal mengikuti docker-compose repositori ini (55432/56379).
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Ekoteologi AR API"
    environment: str = "local"  # local | staging | prod

    database_url: str = "postgresql+asyncpg://ekoteologi:ekoteologi@localhost:55432/ekoteologi"
    redis_url: str = "redis://localhost:56379/0"

    jwt_secret: str = "dev-secret-ganti-di-produksi"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60  # pendek karena ada refresh token (Sprint 1)
    refresh_token_expire_days: int = 30  # "Ingat saya" dicentang
    refresh_token_expire_days_short: int = 1  # tanpa "Ingat saya"

    # Rate limit login (Sprint 1) — fail-open bila Redis tidak tersedia.
    login_max_attempts: int = 5
    login_window_minutes: int = 15

    # Google Sign-In: Web Client ID dari Google Cloud Console (aud pada ID token).
    google_client_id: str = ""

    # Penyimpanan file lokal (avatar). Mount statis di /uploads — volume di prod.
    upload_dir: str = "var/uploads"
    avatar_max_mb: int = 2

    # Dipisah koma; di-parse lewat cors_origin_list.
    cors_origins: str = (
        "http://localhost:5173,http://localhost:5174,http://localhost:5175,"
        "capacitor://localhost,http://localhost"
    )

    # ── LLM Scan (Sprint 2) — PRD §4/§5.3: semuanya via env, tidak ada yang hardcode. ──
    # `llm_mode=mock` (default) → MockProvider, biaya nol saat development/test.
    # `llm_mode=live` → provider OpenAI-compatible; wajib isi api_key/base_url/model,
    # jika belum lengkap otomatis jatuh kembali ke mock (dengan warning log).
    llm_mode: str = "mock"  # mock | live
    llm_api_key: str = ""
    llm_model: str = ""
    llm_fallback_model: str = ""  # model kedua bila primer gagal setelah retry (PRD §4)
    llm_base_url: str = ""  # mis. https://open.bigmodel.cn/api/paas/v4 (OpenAI-compatible)
    llm_timeout_seconds: float = 30.0
    llm_max_retries: int = 1  # percobaan ulang per model (di luar percobaan pertama)
    llm_retry_backoff_seconds: float = 0.5  # jeda antar retry (0 utk test)

    # ── Scan: batas & cache (Sprint 2) ──
    # Kuota scan/user/hari (keputusan §2.1 #2 — budget LLM; default sementara 20,
    # bisa diubah PO via env tanpa deploy kode).
    scan_daily_limit: int = 20
    scan_image_max_mb: int = 5
    scan_cache_ttl_hours: int = 24  # cache Redis per hash foto (PRD §5.10 #6)
    scan_cache_schema: str = "v1"  # naikkan utk menggusur cache lama saat prompt berubah

    # ── Misi (Sprint 4) ──
    # Batas ukuran foto bukti misi (klaim photo).
    mission_image_max_mb: int = 5

    # ── Biaya LLM (dashboard admin, Sprint 4 — plan §5.3) ──
    # Estimasi biaya per 1.000 token (satuan mata uang lokal, mis. IDR) dan
    # budget bulanan (0 = belum ditetapkan → kartu menampilkan tanpa budget).
    # Mock mode tidak memakai token → biaya Rp0 apa pun nilainya.
    llm_cost_per_1k_tokens: float = 0.0
    llm_budget_monthly: float = 0.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
