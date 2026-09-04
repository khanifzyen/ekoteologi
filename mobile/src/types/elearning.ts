/** Tipe e-learning (Sprint 7) — kontrak endpoint `/v1/modules*` (PRD §5.5). */

export interface ModuleProgress {
  lessons_done: number
  total_lessons: number
  percent: number
  is_completed: boolean
}

export interface ModuleCard {
  id: number
  title: string
  slug: string | null
  description: string | null
  /** URL gambar ATAU nama ikon FontAwesome (mis. `fa-leaf`) — lihat `utils/elearning`. */
  cover_url: string | null
  order: number
  lesson_count: number
  quiz_question_count: number
  quiz_points: number
  progress: ModuleProgress
  /** Mulai / Lanjutkan / Ulangi — diturunkan server (satu sumber). */
  cta: string
}

export interface ModulesPage {
  items: ModuleCard[]
  summary: { completed: number; total: number }
}

export interface LessonBrief {
  id: number
  title: string | null
  order: number
  done: boolean
  block_count: number
}

export interface QuizQuestion {
  id: number
  question: string
  options: string[]
}

export interface QuizIntro {
  id: number
  question_count: number
  pass_percent: number
  points: number
  questions: QuizQuestion[]
}

export interface QuizBest {
  score: number
  total: number
  percent: number
  passed: boolean
  points_awarded: number
}

export interface ModuleDetail {
  id: number
  title: string
  slug: string | null
  description: string | null
  cover_url: string | null
  order: number
  progress: ModuleProgress
  lessons: LessonBrief[]
  quiz: QuizIntro | null
  quiz_best: QuizBest | null
}

/** Blok konten pelajaran (JSONB) — paragraph | quote | tip. */
export interface LessonBlock {
  type: 'paragraph' | 'quote' | 'tip'
  text: string
  arabic?: string | null
  source?: string | null
}

export interface LessonDetail {
  id: number
  module_id: number
  module_title: string
  title: string | null
  order: number
  total_lessons: number
  blocks: LessonBlock[]
  done: boolean
  next_lesson_id: number | null
}

export interface LessonComplete {
  lessons_done: number
  total_lessons: number
  percent: number
  is_completed: boolean
  just_completed: boolean
  message: string
}

export interface ReviewItem {
  question_id: number
  question: string
  choice: number | null
  answer: number
  correct: boolean
  explanation: string | null
}

export interface QuizResult {
  score: number
  total: number
  percent: number
  passed: boolean
  pass_percent: number
  points_awarded: number
  points_total: number
  already_passed_before: boolean
  message: string
  review: ReviewItem[]
}
