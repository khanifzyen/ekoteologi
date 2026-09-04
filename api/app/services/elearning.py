"""Logika bisnis e-learning (Sprint 7) — PRD §5.5/§2.4.

Fungsi murni (teruji): normalisasi blok konten pelajaran, penilaian kuis
otomatis, persen progres, dan penentu CTA kartu modul. Keputusan kerja yang
menyertai (dokumentasi lengkap di laporan sprint):

- **Poin kuis hanya sekali per modul**: `award_points()` lewat ledger hanya
  saat pertama kali LULUS; kuis diulang (lulus lagi) tidak membawa poin baru
  (anti dobel poin — catatan lintas sprint).
- **Progres pelajaran berurutan**: `lessons_done = max(tercatat, order+1)` —
  membaca pelajaran di urutan lebih tinggi tetap dihitung, membaca ulang
  pelajaran lama tidak menurunkan/menggandakan progres.
"""

from dataclasses import dataclass, field

from app.schemas.elearning import BLOCK_TYPES, MAX_BLOCK_TEXT, MAX_BLOCKS

# Ambang & hadiah kuis — diambil dari settings oleh endpoint (env-driven).
DEFAULT_QUIZ_PASS_PERCENT = 70


# ── Blok konten pelajaran (JSONB `lessons.content`) ──


def _clean(value: object, max_len: int = MAX_BLOCK_TEXT) -> str | None:
    """Coerce ke string bersih (None bila kosong) — field opsional blok."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:max_len]


def normalize_blocks(blocks: list[dict] | None) -> list[dict]:
    """Validasi + rapikan list blok konten (murni; ValueError dgn pesan id).

    Bentuk sah per tipe (mockup `elearning.html`):
    - `paragraph` → `{type, text}`
    - `quote`     → `{type, text, arabic?, source?}`
    - `tip`       → `{type, text}`
    """
    if not isinstance(blocks, list) or len(blocks) == 0:
        raise ValueError("Pelajaran butuh minimal satu blok konten.")
    if len(blocks) > MAX_BLOCKS:
        raise ValueError(f"Maksimal {MAX_BLOCKS} blok per pelajaran.")

    normalized: list[dict] = []
    for i, raw in enumerate(blocks):
        if not isinstance(raw, dict):
            raise ValueError(f"Blok #{i + 1} tidak valid — harapannya objek blok.")
        block_type = raw.get("type")
        if block_type not in BLOCK_TYPES:
            raise ValueError(f"Blok #{i + 1}: tipe harus salah satu dari {', '.join(BLOCK_TYPES)}.")
        text = _clean(raw.get("text"))
        if text is None:
            raise ValueError(f"Blok #{i + 1}: teks blok wajib diisi.")
        block: dict = {"type": block_type, "text": text}
        if block_type == "quote":
            block["arabic"] = _clean(raw.get("arabic"))
            block["source"] = _clean(raw.get("source"), 200)
        normalized.append(block)
    return normalized


def block_label(block: dict) -> str:
    """Label singkat satu blok utk daftar admin (murni)."""
    match block.get("type"):
        case "paragraph":
            return "Paragraf"
        case "quote":
            return "Kutipan"
        case "tip":
            return "Tip"
    return "Blok"


# ── Progres modul ──


def next_lessons_done(current: int, lesson_order: int) -> int:
    """`lessons_done` setelah menyelesaikan pelajaran ke-`lesson_order` (murni).

    Berurutan: pelajaran ke-N selesai ⇒ N pelajaran beres. Membaca ulang
    pelajaran lama (order < current) tidak mengubah progres.
    """
    return max(current, lesson_order + 1)


def progress_percent(lessons_done: int, total_lessons: int) -> int:
    """Persen progres kartu modul (0–100, murni)."""
    if total_lessons <= 0:
        return 0
    return max(0, min(100, round(lessons_done / total_lessons * 100)))


def module_cta(*, total_lessons: int, lessons_done: int) -> str:
    """Label tombol kartu modul sesuai mockup (murni): Mulai/Lanjutkan/Ulangi."""
    if total_lessons <= 0 or lessons_done <= 0:
        return "Mulai"
    if lessons_done >= total_lessons:
        return "Ulangi"
    return "Lanjutkan"


# ── Penilaian kuis ──


@dataclass(frozen=True)
class GradedQuestion:
    """Hasil penilaian satu soal (utk review setelah submit)."""

    question_id: int
    question: str
    choice: int | None  # None = tidak dijawab
    answer: int
    correct: bool
    explanation: str | None = None


@dataclass(frozen=True)
class GradedQuiz:
    """Hasil penilaian satu kuis — dipakai endpoint utk menyimpan attempt."""

    score: int
    total: int
    percent: int
    passed: bool
    items: list[GradedQuestion] = field(default_factory=list)


def grade_quiz(
    questions: list[tuple[int, str, int, str | None]],  # (id, teks, kunci, penjelasan)
    answers: dict[int, int],
) -> GradedQuiz:
    """Nilai jawaban terhadap kunci (murni — inti penilaian otomatis).

    `answers` dipetakan question_id → pilihan. Soal tak dijawab dihitung
    salah (pilihan None). Persen = round(score/total*100); lulus bila persen
    ≥ ambang (endpoint memakai `quiz_pass_percent` env) dan total > 0.
    """
    items: list[GradedQuestion] = []
    score = 0
    for question_id, text, answer, explanation in questions:
        choice = answers.get(question_id)
        correct = choice is not None and choice == answer
        if correct:
            score += 1
        items.append(
            GradedQuestion(
                question_id=question_id,
                question=text,
                choice=choice,
                answer=answer,
                correct=correct,
                explanation=explanation,
            )
        )
    total = len(questions)
    percent = progress_percent(score, total)
    return GradedQuiz(score=score, total=total, percent=percent, passed=False, items=items)


def with_threshold(graded: GradedQuiz, pass_percent: int) -> GradedQuiz:
    """Terapkan ambang kelulusan pada hasil `grade_quiz` (murni)."""
    passed = graded.total > 0 and graded.percent >= pass_percent
    return GradedQuiz(
        score=graded.score,
        total=graded.total,
        percent=graded.percent,
        passed=passed,
        items=graded.items,
    )


def quiz_result_message(*, passed: bool, points_awarded: int) -> str:
    """Microcopy ring hasil (Bahasa Indonesia, murni)."""
    if not passed:
        return (
            "Belum lulus — pelajari kembali materinya lalu coba lagi. "
            "Poin menunggumu di percobaan berikutnya."
        )
    if points_awarded > 0:
        return f"MasyaAllah, Lulus! +{points_awarded} poin masuk ke dompet kebaikanmu."
    return "MasyaAllah, Lulus! Kamu sudah meraih poin kuis modul ini sebelumnya."
