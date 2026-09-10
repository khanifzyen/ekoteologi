/** Service e-learning (Sprint 7 → Sprint 13: route hook PocketBase). */

import { pb, toApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type {
  LessonComplete,
  LessonDetail,
  ModuleDetail,
  ModulesPage,
  QuizIntro,
  QuizResult,
} from '@/types/elearning'

/**
 * Seluruh kontrak dilayani route hook `pb_hooks/elearning.pb.js` (sprint 13):
 * penilaian kuis SERVER-SIDE (kunci jawaban tidak pernah ke klien — koleksi
 * `quiz_questions` terkunci dari baca publik), poin sekali per modul via
 * ledger, progres pelajaran berurutan dihitung server, dan konten kartu
 * (CTA/percent) diturunkan server — satu sumber dengan editor admin.
 */

/** Daftar modul tayang + progres saya + ringkasan "N/M modul". */
export async function fetchModules(): Promise<ModulesPage> {
  try {
    return await pb.send<ModulesPage>('/api/ekoteologi/modules', {
      method: 'GET',
      requestKey: null,
    })
  } catch (err) {
    throw toApiError(err)
  }
}

/** Detail modul: pelajaran + intro kuis (tanpa kunci) + hasil terbaik saya. */
export async function fetchModule(moduleId: string): Promise<ModuleDetail> {
  try {
    return await pb.send<ModuleDetail>(`/api/ekoteologi/modules/${moduleId}`, {
      method: 'GET',
      requestKey: null,
    })
  } catch (err) {
    throw toApiError(err)
  }
}

/** Satu pelajaran (blok konten JSON) + posisi dalam modul. */
export async function fetchLesson(lessonId: string): Promise<LessonDetail> {
  try {
    return await pb.send<LessonDetail>(`/api/ekoteologi/lessons/${lessonId}`, {
      method: 'GET',
      requestKey: null,
    })
  } catch (err) {
    throw toApiError(err)
  }
}

/**
 * Tandai pelajaran selesai — progres berurutan dihitung server; pelajaran
 * terakhir yang menuntaskan modul memicu event + streak + badge (sekali).
 */
export async function completeLesson(lessonId: string): Promise<LessonComplete> {
  try {
    return await pb.send<LessonComplete>(`/api/ekoteologi/lessons/${lessonId}/complete`, {
      method: 'POST',
      body: {},
      requestKey: null,
    })
  } catch (err) {
    throw toApiError(err)
  }
}

/** Intro kuis + bank soal (tanpa kunci jawaban — dinilai server). */
export async function fetchQuiz(moduleId: string): Promise<QuizIntro> {
  try {
    return await pb.send<QuizIntro>(`/api/ekoteologi/modules/${moduleId}/quiz`, {
      method: 'GET',
      requestKey: null,
    })
  } catch (err) {
    throw toApiError(err)
  }
}

/**
 * Kirim jawaban kuis → penilaian otomatis server. Lulus pertama kali → poin
 * lewat ledger append-only (anti dobel poin sekali per modul); lulus ulang
 * tetap tercatat tanpa poin (`already_passed_before`). Review memuat kunci +
 * penjelasan sesudah submit — tidak sebelumnya.
 */
export async function submitQuiz(
  moduleId: string,
  answers: { question_id: string; choice: number }[],
): Promise<QuizResult> {
  try {
    const result = await pb.send<QuizResult>(`/api/ekoteologi/modules/${moduleId}/quiz`, {
      method: 'POST',
      body: { answers },
      requestKey: null,
    })
    if (result.points_awarded > 0) {
      // Poin baru masuk — selaraskan pill poin header dari nilai server.
      useAuthStore().applyPoints(result.points_total)
    }
    return result
  } catch (err) {
    throw toApiError(err)
  }
}
