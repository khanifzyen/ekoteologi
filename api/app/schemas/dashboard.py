"""Schema dashboard admin (Sprint 3): KPI read-only — `GET /v1/admin/kpi`.

Angka agregat untuk KPI cards dashboard (mockup `admin/index.html`). Grafik
scan harian & komposisi kategori, biaya LLM, dan antrian verifikasi lengkap
menyusul Sprint 4 sesuai implementation-plan.
"""

from pydantic import BaseModel


class UsersKpi(BaseModel):
    total: int
    new_7d: int  # pendaftar 7 hari terakhir (proxy awal metrik pertumbuhan)


class ScansKpi(BaseModel):
    today: int
    total: int


class VerificationKpi(BaseModel):
    pending: int  # antrian verifikasi bukti misi (isi mulai Sprint 4)


class CacheKpi(BaseModel):
    hit: int
    miss: int
    hit_rate: float | None = None  # persen 0–100; None bila belum ada data


class DashboardKpiOut(BaseModel):
    users: UsersKpi
    scans: ScansKpi
    verification: VerificationKpi
    cache: CacheKpi
