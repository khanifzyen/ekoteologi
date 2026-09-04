"""Skema e-learning (Sprint 7) — modul, pelajaran, kuis, progres — PRD §5.5.

Blok konten pelajaran (`lessons.content` JSONB) berbentuk list dict dengan tipe
terbatas (mockup `elearning.html`): `paragraph` (teks), `quote` (arab + terjemah
+ sumber), `tip` (saran singkat) — divalidasi `normalize_blocks()` di
`services/elearning.py` sehingga editor admin maupun renderer mobile sama-sama
bisa mengandalkan bentuknya.
"""

from pydantic import BaseModel, Field

# Tipe blok konten yang sah (PRD §2.4: paragraph/quote/tip).
BLOCK_TYPES = ("paragraph", "quote", "tip")

MAX_BLOCKS = 50
MAX_BLOCK_TEXT = 5000
MAX_OPTIONS = 6


class ModuleProgressOut(BaseModel):
    """Progres satu modul milik user (bar progres kartu modul — `elearning.html`)."""

    lessons_done: int
    total_lessons: int
    percent: int
    is_completed: bool


class ModuleCardOut(BaseModel):
    """Kartu daftar modul (`viewModul` mockup) + progres untuk bar/CTA."""

    id: int
    title: str
    slug: str | None = None
    description: str | None = None
    cover_url: str | None = None
    order: int
    lesson_count: int
    quiz_question_count: int
    quiz_points: int
    progress: ModuleProgressOut
    cta: str  # Mulai / Lanjutkan / Ulangi (services.elearning.module_cta)


class ModulesSummary(BaseModel):
    """Chip header "N/M modul" `elearning.html`."""

    completed: int
    total: int


class ModulesPage(BaseModel):
    items: list[ModuleCardOut]
    summary: ModulesSummary


class LessonBriefOut(BaseModel):
    id: int
    title: str | None
    order: int
    done: bool  # order < lessons_done (baca berurutan)
    block_count: int


class QuizBestOut(BaseModel):
    score: int
    total: int
    percent: int
    passed: bool
    points_awarded: int


class QuizQuestionOut(BaseModel):
    id: int
    question: str
    options: list[str]


class QuizIntroOut(BaseModel):
    """Info kuis modul — layar intro + bank soal TANPA kunci jawaban."""

    id: int
    question_count: int
    pass_percent: int
    points: int
    questions: list[QuizQuestionOut]


class ModuleDetailOut(BaseModel):
    id: int
    title: str
    slug: str | None = None
    description: str | None = None
    cover_url: str | None = None
    order: int
    progress: ModuleProgressOut
    lessons: list[LessonBriefOut]
    quiz: QuizIntroOut | None = None
    quiz_best: QuizBestOut | None = None


class LessonOut(BaseModel):
    """Satu pelajaran utk dirender (blok konten + navigasi antar pelajaran)."""

    id: int
    module_id: int
    module_title: str
    title: str | None
    order: int
    total_lessons: int
    blocks: list[dict]
    done: bool
    next_lesson_id: int | None = None


class LessonCompleteOut(BaseModel):
    lessons_done: int
    total_lessons: int
    percent: int
    is_completed: bool
    just_completed: bool  # True = pelajaran terakhir selesai saat ini (event+streak)
    message: str


class AnswerIn(BaseModel):
    question_id: int
    choice: int = Field(ge=0)


class QuizSubmitIn(BaseModel):
    answers: list[AnswerIn] = Field(min_length=1, max_length=50)


class ReviewItemOut(BaseModel):
    question_id: int
    question: str
    choice: int | None  # None = tidak dijawab
    answer: int  # kunci jawaban — hanya dibuka setelah submit
    correct: bool
    explanation: str | None = None


class QuizResultOut(BaseModel):
    """Hasil kuis (ring hasil mockup) — penilaian otomatis di server."""

    score: int
    total: int
    percent: int
    passed: bool
    pass_percent: int
    points_awarded: int  # 0 bila gagal ATAU sudah pernah lulus (anti dobel poin)
    points_total: int  # total poin user setelah penambahan
    already_passed_before: bool
    message: str
    review: list[ReviewItemOut]


# ── Admin ──


class ModuleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    cover_url: str | None = Field(default=None, max_length=1000)
    order: int = 0
    is_published: bool = False


class ModuleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    cover_url: str | None = Field(default=None, max_length=1000)
    order: int | None = None
    is_published: bool | None = None


class AdminLessonCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    blocks: list[dict] = Field(min_length=1, max_length=MAX_BLOCKS)
    order: int | None = None  # None = di akhir


class AdminLessonUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    blocks: list[dict] | None = Field(default=None, min_length=1, max_length=MAX_BLOCKS)
    order: int | None = None


class AdminLessonOut(BaseModel):
    id: int
    module_id: int
    title: str | None
    order: int
    blocks: list[dict]


class AdminQuestionCreate(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(min_length=2, max_length=MAX_OPTIONS)
    answer: int = Field(ge=0)
    explanation: str | None = Field(default=None, max_length=2000)
    order: int | None = None  # None = di akhir


class AdminQuestionUpdate(BaseModel):
    question: str | None = Field(default=None, min_length=1, max_length=2000)
    options: list[str] | None = Field(default=None, min_length=2, max_length=MAX_OPTIONS)
    answer: int | None = Field(default=None, ge=0)
    explanation: str | None = Field(default=None, max_length=2000)
    order: int | None = None


class AdminQuestionOut(BaseModel):
    id: int
    quiz_id: int
    question: str
    options: list[str]
    answer: int
    explanation: str | None
    order: int


class AdminModuleOut(BaseModel):
    id: int
    title: str
    slug: str | None
    description: str | None
    cover_url: str | None
    order: int
    is_published: bool
    lesson_count: int
    question_count: int
