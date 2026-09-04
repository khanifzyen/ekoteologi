"""Schema dashboard admin (Sprint 3–4): KPI cards + 2 chart + biaya LLM.

Sprint 4 menambah: kartu Biaya LLM (estimasi dari `llm_meta.tokens` — plan §5.3)
dan `GET /v1/admin/charts` (scan harian & komposisi kategori, mockup
`admin/index.html`).
"""

from datetime import date

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


class LlmKpi(BaseModel):
    """Kartu Biaya LLM (Sprint 4) — estimasi dari token tercatat bulan berjalan.

    Mock mode tidak memakai token → cost 0 (Rp0) apa pun nilai rate env.
    """

    cost_month: float
    tokens_month: int
    budget_monthly: float | None = None  # None bila `LLM_BUDGET_MONTHLY` tidak diset (0)


class DashboardKpiOut(BaseModel):
    users: UsersKpi
    scans: ScansKpi
    verification: VerificationKpi
    cache: CacheKpi
    llm: LlmKpi


# ── Chart (Sprint 4) ──


class DailyCount(BaseModel):
    date: date
    count: int


class CategoryCount(BaseModel):
    name: str
    icon: str | None = None
    count: int
    percentage: float  # 0–100 dari total scan 7 hari


class ChartsOut(BaseModel):
    """Data 2 chart dashboard (`admin/index.html`): garis scan harian + batang kategori."""

    days: int
    daily: list[DailyCount]  # N hari terakhir (hari tanpa scan = 0)
    categories: list[CategoryCount]  # 7 hari terakhir, terbanyak lebih dulu
    categories_total: int
