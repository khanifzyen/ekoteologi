"""Admin: CRUD e-learning (Sprint 7) — modul, pelajaran (blok JSONB), bank soal.

- `GET/POST/PATCH/DELETE /v1/admin/modules`             — modul (tayang/draft).
- `POST /v1/admin/modules/{id}/lessons` + PATCH/DELETE   — pelajaran blok
  paragraph/quote/tip (JSONB `lessons.content`, validasi `normalize_blocks`).
- `POST /v1/admin/modules/{id}/questions` + PATCH/DELETE — bank soal kuis
  (kuis per modul dibuat lazily saat soal pertama ditambahkan).

Tulis: admin|editor; hapus: admin saja. Hapus modul ditolak 409 bila sudah
ada progres/attempt user (riwayat belajar terjaga — pola misi Sprint 4).
"""

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, require_roles
from app.models import (
    Lesson,
    Module,
    Quiz,
    QuizQuestion,
    User,
    UserModuleProgress,
    UserQuizAttempt,
)
from app.schemas.elearning import (
    AdminLessonCreate,
    AdminLessonOut,
    AdminLessonUpdate,
    AdminModuleOut,
    AdminQuestionCreate,
    AdminQuestionOut,
    AdminQuestionUpdate,
    ModuleCreate,
    ModuleUpdate,
)
from app.services.elearning import normalize_blocks

logger = logging.getLogger("ekoteologi.elearning-admin")

router = APIRouter(prefix="/v1/admin", tags=["admin"])

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(title: str) -> str:
    """Slug sederhana dari judul (murni): huruf kecil + tanda hubung."""
    return _SLUG_RE.sub("-", title.strip().lower()).strip("-")[:200] or "modul"


async def _unique_slug(db: AsyncSession, title: str, *, exclude_id: int | None = None) -> str:
    base = slugify(title)
    slug = base
    n = 2
    while True:
        stmt = select(Module).where(Module.slug == slug)
        if exclude_id is not None:
            stmt = stmt.where(Module.id != exclude_id)
        if (await db.scalars(stmt)).first() is None:
            return slug
        slug = f"{base}-{n}"
        n += 1


async def _module_counts(db: AsyncSession, module_id: int) -> tuple[int, int]:
    lesson_count = int(
        await db.scalar(
            select(func.count()).select_from(Lesson).where(Lesson.module_id == module_id)
        )
        or 0
    )
    question_count = 0
    quiz = (await db.scalars(select(Quiz).where(Quiz.module_id == module_id))).first()
    if quiz is not None:
        question_count = int(
            await db.scalar(
                select(func.count())
                .select_from(QuizQuestion)
                .where(QuizQuestion.quiz_id == quiz.id)
            )
            or 0
        )
    return lesson_count, question_count


def _module_out(module: Module, lesson_count: int, question_count: int) -> AdminModuleOut:
    return AdminModuleOut(
        id=module.id,
        title=module.title,
        slug=module.slug,
        description=module.description,
        cover_url=module.cover_url,
        order=module.order,
        is_published=bool(module.is_published),
        lesson_count=lesson_count,
        question_count=question_count,
    )


async def _get_module_or_404(db: AsyncSession, module_id: int) -> Module:
    module = await db.get(Module, module_id)
    if module is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Modul tidak ditemukan.")
    return module


async def _get_quiz(db: AsyncSession, module_id: int) -> Quiz | None:
    return (await db.scalars(select(Quiz).where(Quiz.module_id == module_id))).first()


async def _get_or_create_quiz(db: AsyncSession, module_id: int) -> Quiz:
    quiz = await _get_quiz(db, module_id)
    if quiz is None:
        quiz = Quiz(module_id=module_id)
        db.add(quiz)
        await db.flush()
    return quiz


# ── Modul ──


@router.get("/modules", response_model=list[AdminModuleOut])
async def list_modules(
    _user: User = Depends(require_roles("admin", "verifier", "editor")),
    db: AsyncSession = Depends(get_db),
) -> list[AdminModuleOut]:
    """Semua modul (termasuk draft) urut `order` — tabel admin."""
    modules = (await db.scalars(select(Module).order_by(Module.order.asc(), Module.id.asc()))).all()
    out: list[AdminModuleOut] = []
    for module in modules:
        lesson_count, question_count = await _module_counts(db, module.id)
        out.append(_module_out(module, lesson_count, question_count))
    return out


@router.post("/modules", response_model=AdminModuleOut, status_code=201)
async def create_module(
    payload: ModuleCreate,
    _user: User = Depends(require_roles("admin", "editor")),
    db: AsyncSession = Depends(get_db),
) -> AdminModuleOut:
    slug = (payload.slug or "").strip() or await _unique_slug(db, payload.title)
    clash = (await db.scalars(select(Module).where(Module.slug == slug))).first()
    if clash is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f'Slug "{slug}" sudah dipakai modul lain.')
    module = Module(
        title=payload.title.strip(),
        slug=slug,
        description=payload.description,
        cover_url=payload.cover_url,
        order=payload.order,
        is_published=payload.is_published,
    )
    db.add(module)
    await db.commit()
    await db.refresh(module)
    logger.info("MODULE CREATED id=%s title=%s", module.id, module.title)
    return _module_out(module, 0, 0)


@router.patch("/modules/{module_id}", response_model=AdminModuleOut)
async def update_module(
    module_id: int,
    payload: ModuleUpdate,
    _user: User = Depends(require_roles("admin", "editor")),
    db: AsyncSession = Depends(get_db),
) -> AdminModuleOut:
    module = await _get_module_or_404(db, module_id)
    data = payload.model_dump(exclude_unset=True)

    if "title" in data and data["title"]:
        module.title = data["title"].strip()
    if "slug" in data:
        new_slug = (data["slug"] or "").strip() or await _unique_slug(
            db, module.title, exclude_id=module.id
        )
        if new_slug != module.slug:
            clash = (await db.scalars(select(Module).where(Module.slug == new_slug))).first()
            if clash is not None and clash.id != module.id:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f'Slug "{new_slug}" sudah dipakai modul lain.',
                )
            module.slug = new_slug
    for field in ("description", "cover_url", "order", "is_published"):
        if field in data:
            setattr(module, field, data[field])

    await db.commit()
    await db.refresh(module)
    lesson_count, question_count = await _module_counts(db, module.id)
    logger.info("MODULE UPDATED id=%s", module.id)
    return _module_out(module, lesson_count, question_count)


@router.delete("/modules/{module_id}", status_code=204)
async def delete_module(
    module_id: int,
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Hapus modul — ditolak bila ada progres/attempt user (riwayat terjaga)."""
    module = await _get_module_or_404(db, module_id)
    has_progress = (
        await db.scalars(
            select(UserModuleProgress.module_id).where(UserModuleProgress.module_id == module_id)
        )
    ).first()
    quiz = await _get_quiz(db, module_id)
    has_attempt = False
    if quiz is not None:
        has_attempt = (
            await db.scalars(select(UserQuizAttempt.id).where(UserQuizAttempt.quiz_id == quiz.id))
        ).first() is not None
    if has_progress or has_attempt:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Modul sudah pernah dikerjakan pengguna — nonaktifkan (draft) saja.",
        )
    await db.delete(module)
    await db.commit()
    logger.info("MODULE DELETED id=%s", module_id)


# ── Pelajaran (blok JSONB) ──


async def _lesson_out(lesson: Lesson) -> AdminLessonOut:
    return AdminLessonOut(
        id=lesson.id,
        module_id=lesson.module_id,
        title=lesson.title,
        order=lesson.order,
        blocks=list(lesson.content or []),
    )


async def _next_lesson_order(db: AsyncSession, module_id: int) -> int:
    current = await db.scalar(select(func.max(Lesson.order)).where(Lesson.module_id == module_id))
    # `0` falsy — jangan pakai `or` (max order 0 harus lanjut ke 1).
    return (current if current is not None else -1) + 1


@router.get("/modules/{module_id}/lessons", response_model=list[AdminLessonOut])
async def list_lessons(
    module_id: int,
    _user: User = Depends(require_roles("admin", "verifier", "editor")),
    db: AsyncSession = Depends(get_db),
) -> list[AdminLessonOut]:
    """Pelajaran modul (urut) dgn blok penuh — editor admin."""
    module = await _get_module_or_404(db, module_id)
    lessons = (
        await db.scalars(
            select(Lesson)
            .where(Lesson.module_id == module.id)
            .order_by(Lesson.order.asc(), Lesson.id.asc())
        )
    ).all()
    return [await _lesson_out(lesson) for lesson in lessons]


@router.post("/modules/{module_id}/lessons", response_model=AdminLessonOut, status_code=201)
async def create_lesson(
    module_id: int,
    payload: AdminLessonCreate,
    _user: User = Depends(require_roles("admin", "editor")),
    db: AsyncSession = Depends(get_db),
) -> AdminLessonOut:
    module = await _get_module_or_404(db, module_id)
    try:
        blocks = normalize_blocks(payload.blocks)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    order = payload.order if payload.order is not None else await _next_lesson_order(db, module.id)
    lesson = Lesson(module_id=module.id, title=payload.title, content=blocks, order=order)
    db.add(lesson)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Pelajaran gagal disimpan — muat ulang lalu coba lagi."
        ) from None
    await db.refresh(lesson)
    logger.info("LESSON CREATED id=%s module=%s", lesson.id, module.id)
    return await _lesson_out(lesson)


@router.patch("/lessons/{lesson_id}", response_model=AdminLessonOut)
async def update_lesson(
    lesson_id: int,
    payload: AdminLessonUpdate,
    _user: User = Depends(require_roles("admin", "editor")),
    db: AsyncSession = Depends(get_db),
) -> AdminLessonOut:
    lesson = await db.get(Lesson, lesson_id)
    if lesson is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pelajaran tidak ditemukan.")
    data = payload.model_dump(exclude_unset=True)
    if "title" in data:
        lesson.title = data["title"]
    if "blocks" in data and data["blocks"] is not None:
        try:
            lesson.content = normalize_blocks(data["blocks"])
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    if "order" in data and data["order"] is not None:
        lesson.order = data["order"]
    await db.commit()
    await db.refresh(lesson)
    logger.info("LESSON UPDATED id=%s", lesson.id)
    return await _lesson_out(lesson)


@router.delete("/lessons/{lesson_id}", status_code=204)
async def delete_lesson(
    lesson_id: int,
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
) -> None:
    lesson = await db.get(Lesson, lesson_id)
    if lesson is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pelajaran tidak ditemukan.")
    await db.delete(lesson)
    await db.commit()
    logger.info("LESSON DELETED id=%s", lesson_id)


# ── Bank soal kuis ──


def _validate_options(options: list[str] | None, answer: int | None) -> tuple[list[str], int]:
    """Rapikan opsi + validasi kunci jawaban (ValueError dgn pesan id)."""
    cleaned = [str(o).strip() for o in (options or []) if str(o).strip()]
    if len(cleaned) < 2:
        raise ValueError("Soal butuh minimal dua pilihan jawaban yang tidak kosong.")
    if len(cleaned) > 6:
        raise ValueError("Maksimal enam pilihan jawaban per soal.")
    if answer is None or not (0 <= answer < len(cleaned)):
        raise ValueError("Kunci jawaban harus salah satu nomor pilihan yang ada.")
    return cleaned, answer


async def _question_out(question: QuizQuestion) -> AdminQuestionOut:
    return AdminQuestionOut(
        id=question.id,
        quiz_id=question.quiz_id or 0,
        question=question.question or "",
        options=[str(o) for o in (question.options or [])],
        answer=question.answer or 0,
        explanation=question.explanation,
        order=question.order,
    )


async def _next_question_order(db: AsyncSession, quiz_id: int) -> int:
    current = await db.scalar(
        select(func.max(QuizQuestion.order)).where(QuizQuestion.quiz_id == quiz_id)
    )
    # `0` falsy — jangan pakai `or` (max order 0 harus lanjut ke 1).
    return (current if current is not None else -1) + 1


@router.get("/modules/{module_id}/questions", response_model=list[AdminQuestionOut])
async def list_questions(
    module_id: int,
    _user: User = Depends(require_roles("admin", "verifier", "editor")),
    db: AsyncSession = Depends(get_db),
) -> list[AdminQuestionOut]:
    """Bank soal modul (urut) — kunci jawaban ikut (panel admin)."""
    module = await _get_module_or_404(db, module_id)
    quiz = await _get_quiz(db, module.id)
    if quiz is None:
        return []
    questions = (
        await db.scalars(
            select(QuizQuestion)
            .where(QuizQuestion.quiz_id == quiz.id)
            .order_by(QuizQuestion.order.asc(), QuizQuestion.id.asc())
        )
    ).all()
    return [await _question_out(q) for q in questions]


@router.post("/modules/{module_id}/questions", response_model=AdminQuestionOut, status_code=201)
async def create_question(
    module_id: int,
    payload: AdminQuestionCreate,
    _user: User = Depends(require_roles("admin", "editor")),
    db: AsyncSession = Depends(get_db),
) -> AdminQuestionOut:
    """Tambah soal — kuis per modul dibuat otomatis saat soal pertama."""
    module = await _get_module_or_404(db, module_id)
    try:
        options, answer = _validate_options(payload.options, payload.answer)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    quiz = await _get_or_create_quiz(db, module.id)
    order = payload.order if payload.order is not None else await _next_question_order(db, quiz.id)
    question = QuizQuestion(
        quiz_id=quiz.id,
        question=payload.question.strip(),
        options=options,
        answer=answer,
        explanation=payload.explanation,
        order=order,
    )
    db.add(question)
    await db.commit()
    await db.refresh(question)
    logger.info("QUESTION CREATED id=%s quiz=%s", question.id, quiz.id)
    return await _question_out(question)


@router.patch("/questions/{question_id}", response_model=AdminQuestionOut)
async def update_question(
    question_id: int,
    payload: AdminQuestionUpdate,
    _user: User = Depends(require_roles("admin", "editor")),
    db: AsyncSession = Depends(get_db),
) -> AdminQuestionOut:
    question = await db.get(QuizQuestion, question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Soal tidak ditemukan.")
    data = payload.model_dump(exclude_unset=True)

    options = data.get("options")
    answer = data.get("answer", question.answer)
    if options is not None or "answer" in data:
        try:
            cleaned, answer = _validate_options(options or question.options, answer)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
        question.options = cleaned
        question.answer = answer
    if "question" in data and data["question"]:
        question.question = data["question"].strip()
    if "explanation" in data:
        question.explanation = data["explanation"]
    if "order" in data and data["order"] is not None:
        question.order = data["order"]
    await db.commit()
    await db.refresh(question)
    logger.info("QUESTION UPDATED id=%s", question.id)
    return await _question_out(question)


@router.delete("/questions/{question_id}", status_code=204)
async def delete_question(
    question_id: int,
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
) -> None:
    question = await db.get(QuizQuestion, question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Soal tidak ditemukan.")
    await db.delete(question)
    await db.commit()
    logger.info("QUESTION DELETED id=%s", question_id)
