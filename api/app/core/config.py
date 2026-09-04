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
    access_token_expire_minutes: int = 60 * 24

    # Dipisah koma; di-parse lewat cors_origin_list.
    cors_origins: str = (
        "http://localhost:5173,http://localhost:5174,capacitor://localhost,http://localhost"
    )

    # Prasyarat Sprint 2 (implementation-plan §2.2): model & key via env, tidak hardcode.
    llm_api_key: str = ""
    llm_model: str = ""
    llm_base_url: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
