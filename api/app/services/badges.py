"""Badge engine (Sprint 6) — kriteria JSONB `badges.criteria` → evaluasi statistik.

Kriteria berbentuk `{"type": "<jenis>", "value": <target>}` (seed Sprint 1).
Jenis yang dikenali (konstanta `BADGE_CRITERIA_TYPES`):

- `scan_count`    — jumlah scan bernilai poin (`scans.points > 0`; scan duplikat
                    bernilai 0 tidak dihitung — konsisten dgn aturan anti
                    poin-farming streak/auto_scan, keputusan Sprint 2/5).
- `mission_done`  — jumlah klaim misi `approved` (satu-satunya status yang
                    menulis poin — keputusan Sprint 4/5).
- `streak`        — rekor streak user (`longest_streak`, paling stabil karena
                    tidak pernah menurun; field lain lazy-reset).
- `points_earned` — total poin (`users.points`, cache ledger yang selalu
                    disinkronkan `award_points` — PRD §5.10 #1).
- `quiz_passed`   — jumlah kuis lulus (`user_quiz_attempts.passed`) — selalu 0
                    sampai e-learning hidup (Sprint 7); lencana terkait otomatis
                    ikut terbuka tanpa perubahan engine.

Strategi evaluasi = **hybrid on-event + lazy** (keputusan kerja terdokumentasi):
`sync_user_badges()` dipanggil di momen pemberian poin (scan, approve misi —
termasuk manual & auto_scan) sehingga notifikasi lencana baru terkirim di
detik yang sama dgn aksinya, DAN di `GET /v1/badges` (lazy) sehingga lencana
tetap terbayar meski poin dimasukkan lewat jalur lain (mis. penyesuaian admin)
atau sync on-event sempat gagal. Semua penulisan `user_badges` idempoten.
"""

import logging
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Badge,
    Notification,
    PointTransaction,
    Scan,
    User,
    UserBadge,
    UserMission,
    UserQuizAttempt,
)

logger = logging.getLogger("ekoteologi.badges")

# Jenis kriteria yang sah (seed `scripts/seed.py` + PRD §5.2).
SCAN_COUNT = "scan_count"
MISSION_DONE = "mission_done"
STREAK = "streak"
POINTS_EARNED = "points_earned"
QUIZ_PASSED = "quiz_passed"
BADGE_CRITERIA_TYPES = {SCAN_COUNT, MISSION_DONE, STREAK, POINTS_EARNED, QUIZ_PASSED}


@dataclass(frozen=True)
class BadgeStats:
    """Statistik pengguna yang dibandingkan dgn kriteria lencana."""

    scan_count: int = 0
    mission_done: int = 0
    streak: int = 0
    points_earned: int = 0
    quiz_passed: int = 0

    def value_of(self, criteria_type: str) -> int:
        return {
            SCAN_COUNT: self.scan_count,
            MISSION_DONE: self.mission_done,
            STREAK: self.streak,
            POINTS_EARNED: self.points_earned,
            QUIZ_PASSED: self.quiz_passed,
        }.get(criteria_type, 0)


def evaluate_criteria(criteria: dict | None, stats: BadgeStats) -> bool:
    """Evaluasi satu kriteria JSONB terhadap statistik (fungsi murni, teruji).

    Kriteria tidak dikenal/korup (`value` bukan angka positif, `type` asing)
    ⇒ TIDAK diraih (fail-closed) — jangan pernah menghadiahkan lencana karena
    data rusak. Kriteria `None` (tanpa syarat) juga tidak otomatis diraih.
    """
    if not isinstance(criteria, dict):
        return False
    criteria_type = criteria.get("type")
    if criteria_type not in BADGE_CRITERIA_TYPES:
        return False
    target = criteria.get("value")
    if not isinstance(target, (int, float)) or isinstance(target, bool) or target <= 0:
        return False
    return stats.value_of(str(criteria_type)) >= target


async def collect_stats(db: AsyncSession, user: User) -> BadgeStats:
    """Kumpulkan statistik user dari sumber masing-masing (satu query per metrik).

    `scan_count` hanya menghitung scan bernilai poin (anti farming); `streak`
    memakai rekor `longest_streak`; `points_earned` memakai SUM ledger agar
    tetap benar walau cache `users.points` drift (bisa direkonsiliasi).
    """
    scan_count = int(
        await db.scalar(
            select(func.count()).select_from(Scan).where(Scan.user_id == user.id, Scan.points > 0)
        )
        or 0
    )
    mission_done = int(
        await db.scalar(
            select(func.count())
            .select_from(UserMission)
            .where(UserMission.user_id == user.id, UserMission.status == "approved")
        )
        or 0
    )
    points_earned = int(
        await db.scalar(
            select(func.coalesce(func.sum(PointTransaction.amount), 0)).where(
                PointTransaction.user_id == user.id
            )
        )
        or 0
    )
    # Quiz menyusul Sprint 7 — tabel `user_quiz_attempts` sudah ada di skema;
    # dihitung sekarang supaya engine tidak perlu disentuh lagi nanti.
    quiz_passed = int(
        await db.scalar(
            select(func.count())
            .select_from(UserQuizAttempt)
            .where(UserQuizAttempt.user_id == user.id, UserQuizAttempt.passed.is_(True))
        )
        or 0
    )
    return BadgeStats(
        scan_count=scan_count,
        mission_done=mission_done,
        streak=max(user.longest_streak or 0, user.current_streak or 0),
        points_earned=points_earned,
        quiz_passed=quiz_passed,
    )


async def sync_user_badges(db: AsyncSession, *, user: User, notify_new: bool = True) -> list[Badge]:
    """Beri lencana yang sudah layak namun belum dimiliki (idempoten, tanpa commit).

    Dipanggil di dalam transaksi pemanggil (momen award poin / `GET /v1/badges`).
    Bila `notify_new`, satu notifikasi in-app per lencana baru (ikut transaksi —
    sumber push FCM bila kredensial server sudah dipasang). Kembalikan daftar
    lencana baru (urut id) — pemanggil bisa memakainya utk log/respons.
    """
    stats = await collect_stats(db, user)
    owned = set(await db.scalars(select(UserBadge.badge_id).where(UserBadge.user_id == user.id)))
    if owned:
        candidates = (
            await db.scalars(select(Badge).where(Badge.id.not_in(owned)).order_by(Badge.id.asc()))
        ).all()
    else:
        candidates = (await db.scalars(select(Badge).order_by(Badge.id.asc()))).all()

    earned: list[Badge] = []
    for badge in candidates:
        if not evaluate_criteria(badge.criteria, stats):
            continue
        db.add(UserBadge(user_id=user.id, badge_id=badge.id))
        earned.append(badge)
        if notify_new:
            db.add(
                Notification(
                    user_id=user.id,
                    title=f"Lencana baru: {badge.name or badge.code}",
                    body=badge.description or "Kamu baru saja meraih lencana. Pertahankan!",
                    type="info",
                    payload={"badge_id": badge.id, "badge_code": badge.code},
                )
            )
    if earned:
        await db.flush()
        logger.info(
            "BADGES EARNED user=%s codes=%s",
            user.id,
            ",".join(b.code for b in earned),
        )
    return earned
