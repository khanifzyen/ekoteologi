"""Logika bisnis misi (Sprint 4): periode klaim & anti dobel — PRD §2.3/§5.4.

Anti dobel klaim bertumpu pada constraint DB `UNIQUE(user_id, mission_id,
period_date)` (sudah ada sejak skema awal). Kunci periode dihitung server-side
agar klien tidak bisa memilih periodenya sendiri:

- `daily`   → tanggal hari ini;
- `weekly`  → hari Senin minggu berjalan (satu klaim per minggu);
- `special` → tanggal hari ini (fallback aman — tetap anti dobel harian;
  misi spesial MVP selalu berjendek pendek).

`period_date` TIDAK pernah NULL untuk klaim: di PostgreSQL NULL dianggap
berbeda satu sama lain oleh UNIQUE sehingga baris period kosong bisa lolos —
karena itu setiap klaim wajib membawa tanggal periode.
"""

from datetime import date, timedelta

from app.models import Mission

# Nilai sah kolom `missions.type` / `missions.verification` (PRD §5.4).
MISSION_TYPES = ("daily", "weekly", "special")
VERIFICATION_MODES = ("photo", "auto_scan", "manual")


def period_date_for(mission: Mission, today: date | None = None) -> date:
    """Tanggal periode klaim utk misi — dasar constraint anti dobel."""
    day = today or date.today()
    if mission.type == "weekly":
        # Senin minggu berjalan (weekday: Sen=0 … Min=6).
        return day - timedelta(days=day.weekday())
    return day


def is_within_period(mission: Mission, now=None) -> bool:
    """Misi tampil/klaim hanya di dalam jendela `start_at`–`end_at` (bila diisi)."""
    moment = now
    if moment is None:
        from datetime import datetime

        moment = datetime.now().astimezone()
    if mission.start_at is not None and moment < mission.start_at:
        return False
    if mission.end_at is not None and moment > mission.end_at:
        return False
    return True
