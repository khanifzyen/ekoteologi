/** Service e-learning (Sprint 7 → Sprint 10: koleksi `modules`, `lessons`, dll.). */

import { ApiError, currentUserId, pb, toApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type {
  LessonComplete,
  LessonDetail,
  ModuleCard,
  ModuleDetail,
  ModulesPage,
  QuizIntro,
  QuizResult,
} from '@/types/elearning'

/** Konfigurasi kuis (paritas server lama — sprint 7: QUIZ_PASS_PERCENT/QUIZ_POINTS). */
const QUIZ_PASS_PERCENT = 70
const QUIZ_POINTS = 20

interface RawRow {
  [key: string]: unknown
  id: string
}

/**
 * Kumpulkan peta modul → hitungan pelajaran/soal dgn query terkelompok
 * (skala MVP: puluhan baris). Penilaian kuis & poin hook menyusul Sprint 13.
 */
async function loadModuleIndex() {
  const [lessonRows, quizRows, questionRows] = await Promise.all([
    pb.collection('lessons').getFullList<RawRow>({ sort: 'order,created', fields: 'id,module' }),
    pb.collection('quizzes').getFullList<RawRow>({ fields: 'id,module' }),
    pb
      .collection('quiz_questions')
      .getFullList<RawRow>({ fields: 'id,quiz,answer', sort: 'order,created' }),
  ])
  const quizByModule = new Map<string, string>()
  for (const quiz of quizRows) quizByModule.set(String(quiz.module ?? ''), String(quiz.id))
  const lessonsByModule = new Map<string, string[]>()
  for (const lesson of lessonRows) {
    const moduleId = String(lesson.module ?? '')
    lessonsByModule.set(moduleId, [...(lessonsByModule.get(moduleId) ?? []), String(lesson.id)])
  }
  const questionsByQuiz = new Map<string, RawRow[]>()
  for (const question of questionRows) {
    const quizId = String(question.quiz ?? '')
    questionsByQuiz.set(quizId, [...(questionsByQuiz.get(quizId) ?? []), question])
  }
  return { quizByModule, lessonsByModule, questionsByQuiz }
}

async function loadProgressMap(): Promise<Map<string, RawRow>> {
  const rows = await pb.collection('user_module_progress').getFullList<RawRow>({
    filter: `user = "${currentUserId()}"`,
  })
  return new Map(rows.map((row) => [String(row.module ?? ''), row]))
}

function progressOf(row: RawRow | undefined, totalLessons: number) {
  const lessonsDone = Math.min(Number(row?.lessons_done ?? 0), totalLessons)
  const isCompleted = Boolean(row?.is_completed) || (totalLessons > 0 && lessonsDone >= totalLessons)
  const percent = totalLessons > 0 ? Math.round((lessonsDone / totalLessons) * 100) : 0
  return { lessonsDone, isCompleted, percent }
}

function ctaOf(percent: number, isCompleted: boolean): string {
  if (isCompleted) return 'Ulangi'
  if (percent > 0) return 'Lanjutkan'
  return 'Mulai'
}

/** Daftar modul tayang + progres saya + ringkasan "N/M modul". */
export async function fetchModules(): Promise<ModulesPage> {
  try {
    const [moduleRows, index, progressMap] = await Promise.all([
      pb.collection('modules').getFullList<RawRow>({ filter: 'is_published = true', sort: 'order,created' }),
      loadModuleIndex(),
      loadProgressMap(),
    ])
    const items: ModuleCard[] = moduleRows.map((row) => {
      const id = String(row.id)
      const lessonIds = index.lessonsByModule.get(id) ?? []
      const quizId = index.quizByModule.get(id) ?? null
      const questionCount = quizId ? (index.questionsByQuiz.get(quizId)?.length ?? 0) : 0
      const progress = progressOf(progressMap.get(id), lessonIds.length)
      return {
        id,
        title: String(row.title ?? ''),
        slug: (row.slug as string) || null,
        description: (row.description as string) || null,
        cover_url: (row.cover as string) || null,
        order: Number(row.order ?? 0),
        lesson_count: lessonIds.length,
        quiz_question_count: questionCount,
        quiz_points: questionCount > 0 ? QUIZ_POINTS : 0,
        progress: {
          lessons_done: progress.lessonsDone,
          total_lessons: lessonIds.length,
          percent: progress.percent,
          is_completed: progress.isCompleted,
        },
        cta: ctaOf(progress.percent, progress.isCompleted),
      }
    })
    return {
      items,
      summary: { completed: items.filter((m) => m.progress.is_completed).length, total: items.length },
    }
  } catch (err) {
    throw toApiError(err)
  }
}

/** Detail modul: pelajaran + intro kuis + hasil kuis terbaik saya. */
export async function fetchModule(moduleId: string): Promise<ModuleDetail> {
  try {
    const [moduleRow, lessons, index, progressMap, attempts] = await Promise.all([
      pb.collection('modules').getOne<RawRow>(moduleId),
      pb.collection('lessons').getFullList<RawRow>({
        filter: `module = "${moduleId}"`,
        sort: 'order,created',
      }),
      loadModuleIndex(),
      loadProgressMap(),
      pb.collection('user_quiz_attempts').getFullList<RawRow>({
        filter: `user = "${currentUserId()}"`,
        sort: '-created',
      }),
    ])
    const lessonIds = lessons.map((l) => String(l.id))
    const progress = progressOf(progressMap.get(moduleId), lessonIds.length)
    const quizId = index.quizByModule.get(moduleId) ?? null
    const questions = quizId ? (index.questionsByQuiz.get(quizId) ?? []) : []
    const quizAttemptRows = attempts.filter((a) => quizId && String(a.quiz ?? '') === quizId)
    const best = quizAttemptRows.reduce<RawRow | null>((acc, row) => {
      if (!acc || Number(row.score ?? 0) > Number(acc.score ?? 0)) return row
      return acc
    }, null)
    const total = questions.length
    const bestScore = best ? Number(best.score ?? 0) : 0
    return {
      id: String(moduleRow.id),
      title: String(moduleRow.title ?? ''),
      slug: (moduleRow.slug as string) || null,
      description: (moduleRow.description as string) || null,
      cover_url: (moduleRow.cover as string) || null,
      order: Number(moduleRow.order ?? 0),
      progress: {
        lessons_done: progress.lessonsDone,
        total_lessons: lessonIds.length,
        percent: progress.percent,
        is_completed: progress.isCompleted,
      },
      lessons: lessons.map((lesson, i) => ({
        id: String(lesson.id),
        title: (lesson.title as string) || null,
        order: Number(lesson.order ?? i),
        done: progress.lessonsDone > i,
        block_count: Array.isArray(lesson.content) ? (lesson.content as unknown[]).length : 0,
      })),
      quiz: quizId && total > 0
        ? {
            id: quizId,
            question_count: total,
            pass_percent: QUIZ_PASS_PERCENT,
            points: QUIZ_POINTS,
            // Kunci jawaban TIDAK dikirim ke UI (paritas server lama).
            questions: questions.map((q) => ({
              id: String(q.id),
              question: String(q.question ?? ''),
              options: (q.options as string[]) ?? [],
            })),
          }
        : null,
      quiz_best: best
        ? {
            score: bestScore,
            total,
            percent: total > 0 ? Math.round((bestScore / total) * 100) : 0,
            passed: Boolean(best?.passed),
            points_awarded: Number(best?.points_awarded ?? 0),
          }
        : null,
    }
  } catch (err) {
    throw toApiError(err)
  }
}

/** Satu pelajaran (blok konten JSON) + posisi dalam modul. */
export async function fetchLesson(lessonId: string): Promise<LessonDetail> {
  try {
    const lesson = await pb.collection('lessons').getOne<RawRow>(lessonId)
    const moduleId = String(lesson.module ?? '')
    const [moduleRow, siblings, progressMap] = await Promise.all([
      pb.collection('modules').getOne<RawRow>(moduleId),
      pb.collection('lessons').getFullList<RawRow>({
        filter: `module = "${moduleId}"`,
        sort: 'order,created',
      }),
      loadProgressMap(),
    ])
    const position = siblings.findIndex((l) => String(l.id) === lessonId)
    const progress = progressOf(progressMap.get(moduleId), siblings.length)
    const nextLesson = position >= 0 && position + 1 < siblings.length ? siblings[position + 1] : null
    return {
      id: lessonId,
      module_id: moduleId,
      module_title: String(moduleRow.title ?? ''),
      title: (lesson.title as string) || null,
      order: position >= 0 ? position : 0,
      total_lessons: siblings.length,
      blocks: Array.isArray(lesson.content) ? (lesson.content as LessonDetail['blocks']) : [],
      done: progress.lessonsDone > position,
      next_lesson_id: nextLesson ? String(nextLesson.id) : null,
    }
  } catch (err) {
    throw toApiError(err)
  }
}

/**
 * Tandai pelajaran selesai — progres berurutan disimpan di koleksi
 * `user_module_progress` (rule ownership). Poin penyelesaian modul mengikuti
 * modul gamifikasi (Sprint 12).
 */
export async function completeLesson(lessonId: string): Promise<LessonComplete> {
  try {
    const lesson = await pb.collection('lessons').getOne<RawRow>(lessonId)
    const moduleId = String(lesson.module ?? '')
    const total = await pb.collection('lessons').getList(1, 1, {
      filter: `module = "${moduleId}"`,
      fields: 'id',
    })
    const totalLessons = total.totalItems
    const siblings = await pb.collection('lessons').getFullList<RawRow>({
      filter: `module = "${moduleId}"`,
      sort: 'order,created',
    })
    const position = siblings.findIndex((l) => String(l.id) === lessonId)
    const progressMap = await loadProgressMap()
    const existing = progressMap.get(moduleId)
    const lessonsDone = Math.max(progressOf(existing, totalLessons).lessonsDone, position + 1)
    const isCompleted = totalLessons > 0 && lessonsDone >= totalLessons
    const justCompleted = isCompleted && !(existing && Boolean(existing.is_completed))
    const body = {
      user: currentUserId(),
      module: moduleId,
      lessons_done: lessonsDone,
      is_completed: isCompleted,
      completed_at: isCompleted ? new Date().toISOString() : '',
    }
    if (existing) {
      await pb.collection('user_module_progress').update(String(existing.id), body)
    } else {
      await pb.collection('user_module_progress').create(body)
    }
    const percent = totalLessons > 0 ? Math.round((lessonsDone / totalLessons) * 100) : 0
    return {
      lessons_done: lessonsDone,
      total_lessons: totalLessons,
      percent,
      is_completed: isCompleted,
      just_completed: justCompleted,
      message: isCompleted
        ? 'Modul tuntas! Kuis menunggumu untuk poin.'
        : 'Pelajaran selesai — lanjutkan ke pelajaran berikutnya.',
    }
  } catch (err) {
    throw toApiError(err)
  }
}

/** Intro kuis + bank soal (tanpa kunci jawaban). */
export async function fetchQuiz(moduleId: string): Promise<QuizIntro> {
  try {
    const quizzes = await pb.collection('quizzes').getFullList<RawRow>({
      filter: `module = "${moduleId}"`,
    })
    const quizId = quizzes[0] ? String(quizzes[0].id) : ''
    if (!quizId) {
      throw new ApiError(404, 'Kuis untuk modul ini belum tersedia.')
    }
    const questions = await pb.collection('quiz_questions').getFullList<RawRow>({
      filter: `quiz = "${quizId}"`,
      sort: 'order,created',
    })
    return {
      id: quizId,
      question_count: questions.length,
      pass_percent: QUIZ_PASS_PERCENT,
      points: QUIZ_POINTS,
      questions: questions.map((q) => ({
        id: String(q.id),
        question: String(q.question ?? ''),
        options: (q.options as string[]) ?? [],
      })),
    }
  } catch (err) {
    throw toApiError(err)
  }
}

/**
 * Kirim jawaban kuis: penilaian dihitung klien (koleksi soal publik terbit) dan
 * percobaan dicatat append-only di `user_quiz_attempts`. Poin lulus via hook
 * ledger baru mengalir di Sprint 13 — kolom poin tetap tampil 0 sampai saat itu.
 */
export async function submitQuiz(
  moduleId: string,
  answers: { question_id: string; choice: number }[],
): Promise<QuizResult> {
  try {
    const intro = await fetchQuiz(moduleId)
    const quizzes = await pb.collection('quizzes').getFullList<RawRow>({
      filter: `module = "${moduleId}"`,
    })
    const quizId = String(quizzes[0]?.id ?? '')
    const keys = await pb.collection('quiz_questions').getFullList<RawRow>({
      filter: `quiz = "${quizId}"`,
      fields: 'id,answer,explanation',
    })
    const answerKey = new Map(keys.map((k) => [String(k.id), Number(k.answer ?? -1)]))

    const total = intro.questions.length
    let score = 0
    const review = intro.questions.map((question) => {
      const given = answers.find((a) => a.question_id === question.id)
      const answer = answerKey.get(question.id) ?? -1
      const correct = given !== undefined && given.choice === answer
      if (correct) score += 1
      return {
        question_id: question.id,
        question: question.question,
        choice: given ? given.choice : null,
        answer,
        correct,
        explanation: null,
      }
    })
    const percent = total > 0 ? Math.round((score / total) * 100) : 0
    const passed = percent >= intro.pass_percent

    // Anti dobel poin sekali per modul (paritas server lama — penilaian klien
    // sementara; hook penilaian + ledger menyusul Sprint 13).
    const attempts = await pb.collection('user_quiz_attempts').getFullList<RawRow>({
      filter: `user = "${currentUserId()}" && quiz = "${quizId}"`,
      fields: 'id,passed,points_awarded',
    })
    const alreadyPassedBefore = attempts.some((a) => Boolean(a.passed))
    const pointsAwarded = passed && !alreadyPassedBefore ? QUIZ_POINTS : 0

    await pb.collection('user_quiz_attempts').create({
      user: currentUserId(),
      quiz: quizId,
      score,
      total,
      answers: answers.map((a) => ({ question_id: a.question_id, choice: a.choice })),
      points_awarded: pointsAwarded,
      passed,
    })

    const auth = useAuthStore()
    return {
      score,
      total,
      percent,
      passed,
      pass_percent: intro.pass_percent,
      points_awarded: pointsAwarded,
      points_total: auth.user?.points ?? 0,
      already_passed_before: alreadyPassedBefore,
      message: passed
        ? pointsAwarded > 0
          ? 'Jawabanmu lulus — poin kuis akan masuk otomatis di pembaruan berikutnya.'
          : 'Kuis selesai.'
        : 'Belum lulus — pelajari kembali materinya lalu coba lagi.',
      review,
    }
  } catch (err) {
    throw toApiError(err)
  }
}
