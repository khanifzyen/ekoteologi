"""Level engine (Sprint 5) — PRD §5.10 keputusan #2: level TIDAK disimpan.

Level dihitung dari `users.points` vs tangga tabel `levels` (seed Sprint 1:
10 level, 0 → 2.300 poin) setiap kali poin berubah. Sebelumnya logika ini
tersebar ad-hoc di `profile.py` & `admin_users.py`; kini jadi satu engine
murni (mudah diuji) yang juga menghasilkan info level berikutnya utk UI
(sisa poin & progres menuju level berikutnya).
"""

from dataclasses import dataclass

from app.models import Level


@dataclass(frozen=True)
class ResolvedLevel:
    """Hasil resolusi level untuk satu jumlah poin."""

    level: int
    title: str
    min_points: int
    # Level berikutnya (None saat sudah di puncak tangga).
    next_level: int | None = None
    next_title: str | None = None
    next_min_points: int | None = None

    @property
    def points_to_next(self) -> int | None:
        """Sisa poin menuju level berikutnya (None saat puncak)."""
        if self.next_min_points is None:
            return None
        return max(0, self.next_min_points - self.min_points)


def resolve_level(levels: list[Level], points: int) -> ResolvedLevel:
    """Level tertinggi yang `min_points <= points` + info level berikutnya.

    `levels` diharapkan terurut `min_points` menaik (pola seed). Tangga kosong
    → fallback "1 · Pemula" (perilaku lama profil Sprint 1 tetap terjaga).
    """
    if not levels:
        return ResolvedLevel(level=1, title="Pemula", min_points=0)

    resolved = ResolvedLevel(
        level=levels[0].level, title=levels[0].title, min_points=levels[0].min_points
    )
    for lvl in levels:
        if lvl.min_points <= points:
            resolved = ResolvedLevel(level=lvl.level, title=lvl.title, min_points=lvl.min_points)
        else:
            return ResolvedLevel(
                level=resolved.level,
                title=resolved.title,
                min_points=resolved.min_points,
                next_level=lvl.level,
                next_title=lvl.title,
                next_min_points=lvl.min_points,
            )
    return resolved


def level_progress_percent(levels: list[Level], points: int) -> int | None:
    """Persen progres poin di dalam level berjalan menuju level berikutnya.

    None bila sudah di level puncak (tidak ada target berikutnya) — UI menyembunyikan bar.
    """
    current = resolve_level(levels, points)
    if current.next_min_points is None:
        return None
    span = current.next_min_points - current.min_points
    if span <= 0:
        return 100
    return min(100, max(0, round((points - current.min_points) / span * 100)))
