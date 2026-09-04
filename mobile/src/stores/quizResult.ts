/**
 * Store hasil kuis (Sprint 7) — jembatan state QuizView → ResultView.
 *
 * Vue-router mengetatkan tipe `HistoryState` (index signature), jadi hasil
 * kuis dinyalir lewat store memori ini (bukan history state). Konsekuensi
 * yang disengaja: refresh di layar hasil mengosongkan state → ResultView
 * mengarahkan kembali ke intro kuis (bukan menampilkan hasil basi).
 */
import { defineStore } from 'pinia'

import type { QuizResult } from '@/types/elearning'

interface QuizQuestionSnapshot {
  id: number
  question: string
  options: string[]
}

export const useQuizResultStore = defineStore('quizResult', {
  state: () => ({
    result: null as QuizResult | null,
    questions: [] as QuizQuestionSnapshot[],
  }),
  actions: {
    set(result: QuizResult, questions: QuizQuestionSnapshot[]) {
      this.result = result
      this.questions = questions
    },
    clear() {
      this.result = null
      this.questions = []
    },
  },
})
