"""Schema misi & klaim (Sprint 4) — kontrak `GET /v1/missions`, klaim photo,
tab Pencapaian (badge), dan CRUD admin (`/v1/admin/missions*`)."""

from datetime import date, datetime

from pydantic import BaseModel, Field


class ClaimOut(BaseModel):
    """Klaim milik user utk satu misi pada periode berjalan (jika ada)."""

    id: int
    status: str  # in_progress|pending|approved|rejected
    progress_count: int
    points_awarded: int
    review_note: str | None = None
    submitted_at: datetime | None = None


class MissionOut(BaseModel):
    """Satu misi aktif pada daftar mobile (`misi.html`) + status klaim saya."""

    id: int
    title: str
    description: str | None = None
    type: str  # daily|weekly|special
    icon: str | None = None
    points: int
    verification: str  # photo|auto_scan|manual
    required_count: int
    start_at: datetime | None = None
    end_at: datetime | None = None
    my_claim: ClaimOut | None = None


class WeekSummary(BaseModel):
    """Progres panel mingguan di header `misi.html` ("6/10 · +120 poin")."""

    week_done: int  # misi disetujui minggu berjalan
    week_total: int  # misi aktif saat ini (penyebut progres)
    week_points: int  # poin misi yang masuk minggu ini


class MissionsPage(BaseModel):
    items: list[MissionOut]
    summary: WeekSummary


class BadgeOut(BaseModel):
    """Lencana utk tab Pencapaian — `earned` dari `user_badges` (badge engine Sprint 6)."""

    id: int
    code: str
    name: str | None = None
    icon: str | None = None
    description: str | None = None
    earned: bool
    earned_at: datetime | None = None


# ── Admin: CRUD misi ──


class MissionCreate(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    type: str = "daily"  # daily|weekly|special
    icon: str | None = Field(default=None, max_length=100)
    points: int = Field(ge=1, le=10000)
    verification: str  # photo|auto_scan|manual
    scan_category_id: int | None = None
    required_count: int = Field(default=1, ge=1, le=1000)
    start_at: datetime | None = None
    end_at: datetime | None = None
    is_active: bool = True


class MissionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    type: str | None = None
    icon: str | None = Field(default=None, max_length=100)
    points: int | None = Field(default=None, ge=1, le=10000)
    verification: str | None = None
    scan_category_id: int | None = None
    required_count: int | None = Field(default=None, ge=1, le=1000)
    start_at: datetime | None = None
    end_at: datetime | None = None
    is_active: bool | None = None


class MissionAdminOut(MissionOut):
    """Baris daftar misi admin + rekap klaim (total & menunggu verifikasi)."""

    is_active: bool
    claims_total: int = 0
    claims_pending: int = 0


class MissionAdminPage(BaseModel):
    items: list[MissionAdminOut]
    total: int
    limit: int
    offset: int


# ── Admin: antrian klaim (data; aksi approve/reject menyusul Sprint 5) ──


class ClaimUserBrief(BaseModel):
    id: str
    full_name: str
    city: str | None = None


class ClaimMissionBrief(BaseModel):
    id: int
    title: str
    points: int
    verification: str


class ClaimAdminOut(BaseModel):
    id: int
    status: str
    period_date: date | None = None
    progress_count: int
    points_awarded: int
    proof_image_url: str | None = None
    note: str | None = None
    review_note: str | None = None
    consent_at: datetime | None = None
    submitted_at: datetime | None = None
    reviewed_at: datetime | None = None
    user: ClaimUserBrief
    mission: ClaimMissionBrief
    # Total klaim (semua status) milik pengguna ini — konteks "Sejarah" pada
    # layar verifikasi (`verifikasi.html`: "Misi ke-N pengguna ini").
    user_claims_total: int = 0


class ClaimsPage(BaseModel):
    items: list[ClaimAdminOut]
    total: int
    limit: int
    offset: int


class ClaimReviewRequest(BaseModel):
    """Keputusan verifier (Sprint 5) — catatan wajib saat menolak."""

    decision: str  # approved | rejected
    note: str | None = Field(default=None, max_length=1000)


class ClaimResponse(BaseModel):
    """Respons `POST /v1/missions/{id}/claim` — status kartu diperbarui UI."""

    claim: ClaimOut
    message: str
