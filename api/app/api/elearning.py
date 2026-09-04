"""E-Learning untuk user mobile (Sprint 7) — `elearning.html` — PRD §5.5.

- `GET    /v1/modules`                       — daftar modul tayang + progres saya
                                               + ringkasan "N/M modul" (header).
- `GET    /v1/modules/{id}`                  — detail: daftar pelajaran + intro kuis.
- `GET    /v1/lessons/{id}`                  — satu pelajaran (blok konten JSONB).
- `POST   /v1/lessons/{id}/complete`         — tandai pelajaran selesai (progres
                                               berurutan; pelajaran terakhir =
                                               modul selesai → event + streak).
- `GET    /v1/modules/{id}/quiz`             — intro kuis + bank soal (tanpa kunci).
- `POST   /v1/modules/{id}/quiz`             — kirim jawaban → penilaian otomatis;
                                               lulus → attempt tersimpan + poin
                                               SEKALI per modul lewat ledger,
                                               event `modul_selesai`, streak, dan
                                               evaluasi lencana (badge engine).

Konten harian "Refleksi Hari Ini" memakai endpoint Sprint 6 `GET /v1/daily-content`
(satu sumber — tidak diduplikasi di sini).
"""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user, get_db
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
    LessonBriefOut,
    LessonCompleteOut,
    LessonOut,
    ModuleCardOut,
    ModuleDetailOut,
    ModuleProgressOut,
    ModulesPage,
    ModulesSummary,
    QuizBestOut,
    QuizIntroOut,
    QuizQuestionOut,
    QuizResultOut,
    QuizSubmitIn,
    ReviewItemOut,
)
from app.services.badges import sync_user_badges
from app.services.elearning import (
    grade_quiz,
    module_cta,
    next_lessons_done,
    progress_percent,
    quiz_result_message,
    with_threshold,
)
from app.services.ledger import award_points
from app.services.metrics import EVENT_MODUL_SELESAI, track_event
from app.services.notifications import notify
from app.services.streak import touch_streak

logger = logging.getLogger("ekoteologi.elearning")

router = APIRouter(prefix="/v1", tags=["elearning"])


async def _get_published_module(db: AsyncSession, module_id: int) -> Module:
    module = await db.get(Module, module_id)
    if module is None or not module.is_published:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Modul tidak ditemukan.")
    return module


async def _progress(db: AsyncSession, user_id: uuid.UUID, module_id: int) -> UserModuleProgress:
    return (
        await db.scalars(
            select(UserModuleProgress).where(
                UserModuleProgress.user_id == user_id,
                UserModuleProgress.module_id == module_id,
            )
        )
    ).first()


async def _module_questions(db: AsyncSession, quiz_id: int) -> list[QuizQuestion]:
    return (
        await db.scalars(
            select(QuizQuestion)
            .where(QuizQuestion.quiz_id == quiz_id)
            .order_by(QuizQuestion.order.asc(), QuizQuestion.id.asc())
        )
    ).all()


def _progress_out(progress: UserModuleProgress | None, total_lessons: int) -> ModuleProgressOut:
    lessons_done = progress.lessons_done if progress else 0
    is_completed = bool(progress and progress.is_completed)
    return ModuleProgressOut(
        lessons_done=lessons_done,
        total_lessons=total_lessons,
        percent=progress_percent(lessons_done, total_lessons),
        is_completed=is_completed,
    )


@router.get("/modules", response_model=ModulesPage)
async def list_modules(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ModulesPage:
    """Daftar modul tayang (urut `order`) + progres saya — kartu `elearning.html`."""
    modules = (
        await db.scalars(
            select(Module)
            .where(Module.is_published.is_(True))
            .order_by(Module.order.asc(), Module.id.asc())
        )
    ).all()

    items: list[ModuleCardOut] = []
    completed = 0
    for module in modules:
        total_lessons = int(
            await db.scalar(
                select(func.count()).select_from(Lesson).where(Lesson.module_id == module.id)
            )
            or 0
        )
        question_count = 0
        quiz = (await db.scalars(select(Quiz).where(Quiz.module_id == module.id))).first()
        if quiz is not None:
            question_count = int(
                await db.scalar(
                    select(func.count())
                    .select_from(QuizQuestion)
                    .where(QuizQuestion.quiz_id == quiz.id)
                )
                or 0
            )
        progress = await _progress(db, user.id, module.id)
        if progress is not None and progress.is_completed:
            completed += 1
        progress_out = _progress_out(progress, total_lessons)
        items.append(
            ModuleCardOut(
                id=module.id,
                title=module.title,
                slug=module.slug,
                description=module.description,
                cover_url=module.cover_url,
                order=module.order,
                lesson_count=total_lessons,
                quiz_question_count=question_count,
                quiz_points=get_settings().quiz_points,
                progress=progress_out,
                cta=module_cta(total_lessons=total_lessons, lessons_done=progress_out.lessons_done),
            )
        )
    return ModulesPage(
        items=items,
        summary=ModulesSummary(completed=completed, total=len(items)),
    )


@router.get("/modules/{module_id}", response_model=ModuleDetailOut)
async def module_detail(
    module_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ModuleDetailOut:
    """Detail modul: pelajaran (urut) + intro kuis + hasil kuis terbaik saya."""
    module = await _get_published_module(db, module_id)
    progress = await _progress(db, user.id, module.id)

    lessons = (
        await db.scalars(
            select(Lesson)
            .where(Lesson.module_id == module.id)
            .order_by(Lesson.order.asc(), Lesson.id.asc())
        )
    ).all()
    total_lessons = len(lessons)
    lessons_done = progress.lessons_done if progress else 0

    quiz_out: QuizIntroOut | None = None
    quiz_best: QuizBestOut | None = None
    quiz = (await db.scalars(select(Quiz).where(Quiz.module_id == module.id))).first()
    if quiz is not None:
        questions = await _module_questions(db, quiz.id)
        if questions:
            quiz_out = QuizIntroOut(
                id=quiz.id,
                question_count=len(questions),
                pass_percent=get_settings().quiz_pass_percent,
                points=get_settings().quiz_points,
                questions=[
                    QuizQuestionOut(
                        id=q.id,
                        question=q.question or "",
                        options=[str(o) for o in (q.options or [])],
                    )
                    for q in questions
                ],
            )
        best = (
            await db.scalars(
                select(UserQuizAttempt)
                .where(
                    UserQuizAttempt.user_id == user.id,
                    UserQuizAttempt.quiz_id == quiz.id,
                )
                .order_by(UserQuizAttempt.score.desc(), UserQuizAttempt.attempted_at.desc())
            )
        ).first()
        if best is not None and best.total:
            quiz_best = QuizBestOut(
                score=best.score or 0,
                total=best.total,
                percent=best.percent_score or 0,
                passed=bool(best.passed),
                points_awarded=best.points_awarded or 0,
            )

    return ModuleDetailOut(
        id=module.id,
        title=module.title,
        slug=module.slug,
        description=module.description,
        cover_url=module.cover_url,
        order=module.order,
        progress=_progress_out(progress, total_lessons),
        lessons=[
            LessonBriefOut(
                id=lesson.id,
                title=lesson.title,
                order=lesson.order,
                done=lesson.order < lessons_done,
                block_count=len(lesson.content or []),
            )
            for lesson in lessons
        ],
        quiz=quiz_out,
        quiz_best=quiz_best,
    )


@router.get("/lessons/{lesson_id}", response_model=LessonOut)
async def lesson_detail(
    lesson_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LessonOut:
    """Satu pelajaran: blok konten terurut + pelajaran berikutnya (CTA lanjut)."""
    lesson = await db.get(Lesson, lesson_id)
    module = await db.get(Module, lesson.module_id) if lesson else None
    if lesson is None or module is None or not module.is_published:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pelajaran tidak ditemukan.")

    siblings = (
        await db.scalars(
            select(Lesson)
            .where(Lesson.module_id == module.id)
            .order_by(Lesson.order.asc(), Lesson.id.asc())
        )
    ).all()
    total = len(siblings)
    progress = await _progress(db, user.id, module.id)
    lessons_done = progress.lessons_done if progress else 0

    idx = siblings.index(lesson)
    next_lesson = siblings[idx + 1] if idx + 1 < total else None

    return LessonOut(
        id=lesson.id,
        module_id=module.id,
        module_title=module.title,
        title=lesson.title,
        order=lesson.order,
        total_lessons=total,
        blocks=list(lesson.content or []),
        done=lesson.order < lessons_done,
        next_lesson_id=next_lesson.id if next_lesson else None,
    )


@router.post("/lessons/{lesson_id}/complete", response_model=LessonCompleteOut)
async def complete_lesson(
    lesson_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LessonCompleteOut:
    """Tandai pelajaran selesai — progres berurutan (`lessons_done = max(order+1)`).

    Pelajaran TERAKHIR yang menuntaskan modul memicu (sekali — transisi):
    event `modul_selesai` (PRD §8), streak berdetak, dan evaluasi lencana
    on-event. Tidak ada poin dari pelajaran — poin hanya kuis (keputusan).
    """
    lesson = await db.get(Lesson, lesson_id)
    module = await db.get(Module, lesson.module_id) if lesson else None
    if lesson is None or module is None or not module.is_published:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pelajaran tidak ditemukan.")

    total_lessons = int(
        await db.scalar(
            select(func.count()).select_from(Lesson).where(Lesson.module_id == module.id)
        )
        or 0
    )
    progress = await _progress(db, user.id, module.id)
    now = datetime.now().astimezone()

    if progress is None:
        progress = UserModuleProgress(user_id=user.id, module_id=module.id, lessons_done=0)
        db.add(progress)

    just_completed = False
    progress.lessons_done = next_lessons_done(progress.lessons_done, lesson.order)
    if not progress.is_completed and total_lessons > 0 and progress.lessons_done >= total_lessons:
        progress.is_completed = True
        progress.completed_at = now
        just_completed = True
        await track_event(
            db,
            user_id=user.id,
            name=EVENT_MODUL_SELESAI,
            payload={"module_id": module.id, "source": "pelajaran"},
        )
        await touch_streak(db, user=user, now=now)
        for badge in await sync_user_badges(db, user=user):
            logger.info("BADGE %s earned oleh user=%s (modul selesai)", badge.code, user.id)

    await db.commit()
    await db.refresh(progress)

    logger.info(
        "LESSON COMPLETE user=%s module=%s lesson=%s done=%d/%d",
        user.id,
        module.id,
        lesson.id,
        progress.lessons_done,
        total_lessons,
    )
    return LessonCompleteOut(
        lessons_done=progress.lessons_done,
        total_lessons=total_lessons,
        percent=progress_percent(progress.lessons_done, total_lessons),
        is_completed=progress.is_completed,
        just_completed=just_completed,
        message=(
            "MasyaAllah! Modul ini tuntas — lanjutkan ke kuisnya untuk poin."
            if just_completed
            else "Pelajaran ditandai selesai."
        ),
    )


@router.get("/modules/{module_id}/quiz", response_model=QuizIntroOut)
async def quiz_intro(
    module_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> QuizIntroOut:
    """Intro kuis + bank soal TANPA kunci jawaban (`viewKuis` intro)."""
    del user
    module = await _get_published_module(db, module_id)
    quiz = (await db.scalars(select(Quiz).where(Quiz.module_id == module.id))).first()
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Modul ini belum memiliki kuis.")
    questions = await _module_questions(db, quiz.id)
    if not questions:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kuis modul ini belum memiliki soal.")
    return QuizIntroOut(
        id=quiz.id,
        question_count=len(questions),
        pass_percent=get_settings().quiz_pass_percent,
        points=get_settings().quiz_points,
        questions=[
            QuizQuestionOut(
                id=q.id,
                question=q.question or "",
                options=[str(o) for o in (q.options or [])],
            )
            for q in questions
        ],
    )


@router.post("/modules/{module_id}/quiz", response_model=QuizResultOut)
async def submit_quiz(
    module_id: int,
    payload: QuizSubmitIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> QuizResultOut:
    """Kirim jawaban → penilaian otomatis server (kunci tidak pernah ke klien).

    Lulus → attempt `passed=true` + poin **sekali per modul** (keputusan
    anti dobel poin: kuis diulang tetap lulus = 0 poin), notifikasi, event
    `modul_selesai` (source=kuis), streak, dan evaluasi lencana on-event.
    Gagal → attempt tetap tersimpan (riwayat) tanpa poin.
    """
    module = await _get_published_module(db, module_id)
    quiz = (await db.scalars(select(Quiz).where(Quiz.module_id == module.id))).first()
    if quiz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Modul ini belum memiliki kuis.")

    questions = await _module_questions(db, quiz.id)
    if not questions:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kuis modul ini belum memiliki soal.")

    question_ids = {q.id for q in questions}
    answers = {a.question_id: a.choice for a in payload.answers if a.question_id in question_ids}
    if not answers:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Jawaban tidak cocok dengan soal kuis ini."
        )

    settings = get_settings()
    graded = with_threshold(
        grade_quiz(
            [(q.id, q.question or "", q.answer or 0, q.explanation) for q in questions],
            answers,
        ),
        settings.quiz_pass_percent,
    )

    # Anti dobel poin: pernah lulus kuis modul ini sebelumnya?
    already_passed = (
        await db.scalars(
            select(UserQuizAttempt.id).where(
                UserQuizAttempt.user_id == user.id,
                UserQuizAttempt.quiz_id == quiz.id,
                UserQuizAttempt.passed.is_(True),
            )
        )
    ).first() is not None

    points_awarded = 0
    points_total = user.points
    now = datetime.now().astimezone()

    if graded.passed and not already_passed:
        attempt = UserQuizAttempt(
            user_id=user.id,
            quiz_id=quiz.id,
            score=graded.score,
            total=graded.total,
            answers=[{"question_id": a.question_id, "choice": a.choice} for a in payload.answers],
            points_awarded=0,
            passed=True,
        )
        db.add(attempt)
        await db.flush()  # attempt.id utk ref_id ledger
        points_awarded = settings.quiz_points
        attempt.points_awarded = points_awarded
        points_total = await award_points(
            db,
            user=user,
            amount=points_awarded,
            source="quiz",
            ref_id=attempt.id,
            note=f"Kuis modul: {module.title}",
        )
        notify(
            db,
            user_id=user.id,
            title="Poin kuis masuk",
            body=(
                f'Kuis "{module.title}" lulus ({graded.percent}%) — '
                f"+{points_awarded} poin masuk ke akunmu."
            ),
            type_="info",
            payload={"module_id": module.id, "quiz_id": quiz.id, "points": points_awarded},
        )
        await track_event(
            db,
            user_id=user.id,
            name=EVENT_MODUL_SELESAI,
            payload={
                "module_id": module.id,
                "quiz_id": quiz.id,
                "score": graded.score,
                "total": graded.total,
                "source": "kuis",
            },
        )
        await touch_streak(db, user=user, now=now)
        for badge in await sync_user_badges(db, user=user):
            logger.info("BADGE %s earned oleh user=%s (kuis lulus)", badge.code, user.id)
    else:
        db.add(
            UserQuizAttempt(
                user_id=user.id,
                quiz_id=quiz.id,
                score=graded.score,
                total=graded.total,
                answers=[
                    {"question_id": a.question_id, "choice": a.choice} for a in payload.answers
                ],
                points_awarded=0,
                passed=graded.passed,  # lulus ulang tanpa poin (sudah pernah)
            )
        )

    await db.commit()

    logger.info(
        "QUIZ SUBMIT user=%s module=%s score=%d/%d passed=%s points=%d",
        user.id,
        module.id,
        graded.score,
        graded.total,
        graded.passed,
        points_awarded,
    )
    return QuizResultOut(
        score=graded.score,
        total=graded.total,
        percent=graded.percent,
        passed=graded.passed,
        pass_percent=settings.quiz_pass_percent,
        points_awarded=points_awarded,
        points_total=points_total,
        already_passed_before=already_passed,
        message=quiz_result_message(passed=graded.passed, points_awarded=points_awarded),
        review=[
            ReviewItemOut(
                question_id=item.question_id,
                question=item.question,
                choice=item.choice,
                answer=item.answer,
                correct=item.correct,
                explanation=item.explanation,
            )
            for item in graded.items
        ],
    )
