/** Service e-learning (Sprint 7) — endpoint `/v1/modules*` & `/v1/lessons*`. */

import { api } from '@/api/client'
import type {
  LessonComplete,
  LessonDetail,
  ModuleDetail,
  ModulesPage,
  QuizIntro,
  QuizResult,
} from '@/types/elearning'

/** Daftar modul tayang + progres saya + ringkasan "N/M modul". */
export function fetchModules(): Promise<ModulesPage> {
  return api<ModulesPage>('/v1/modules')
}

/** Detail modul: pelajaran + intro kuis + hasil kuis terbaik saya. */
export function fetchModule(moduleId: number): Promise<ModuleDetail> {
  return api<ModuleDetail>(`/v1/modules/${moduleId}`)
}

/** Satu pelajaran (blok konten JSONB). */
export function fetchLesson(lessonId: number): Promise<LessonDetail> {
  return api<LessonDetail>(`/v1/lessons/${lessonId}`)
}

/** Tandai pelajaran selesai (progres berurutan; pelajaran terakhir = modul tuntas). */
export function completeLesson(lessonId: number): Promise<LessonComplete> {
  return api<LessonComplete>(`/v1/lessons/${lessonId}/complete`, { method: 'POST' })
}

/** Intro kuis + bank soal (tanpa kunci jawaban). */
export function fetchQuiz(moduleId: number): Promise<QuizIntro> {
  return api<QuizIntro>(`/v1/modules/${moduleId}/quiz`)
}

/** Kirim jawaban → penilaian otomatis server (poin saat lulus, sekali per modul). */
export function submitQuiz(
  moduleId: number,
  answers: { question_id: number; choice: number }[],
): Promise<QuizResult> {
  return api<QuizResult>(`/v1/modules/${moduleId}/quiz`, {
    method: 'POST',
    body: { answers },
  })
}
