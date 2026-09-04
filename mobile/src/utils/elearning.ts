/**
 * Util e-learning (Sprint 7) — mikrokonteks kartu modul, blok pelajaran, dan
 * ring hasil kuis sesuai mockup `elearning.html` (fungsi murni, teruji).
 */

import type { LessonBlock, ModuleCard } from '@/types/elearning'

/** Persen progres kartu modul (0–100, dijepit). */
export function modulePercent(module: Pick<ModuleCard, 'progress'>): number {
  return Math.max(0, Math.min(100, module.progress.percent))
}

/** Label persen kartu mockup: "Baru" (0%) / "50%" / "Selesai" (100%). */
export function progressLabel(module: Pick<ModuleCard, 'progress'>): string {
  const percent = modulePercent(module)
  if (percent >= 100 || module.progress.is_completed) return 'Selesai'
  if (percent <= 0) return 'Baru'
  return `${percent}%`
}

/**
 * `cover_url` server bisa berupa URL gambar (http…/atau data:) atau nama ikon
 * FontAwesome seed (mis. `fa-leaf`) — keputusan kerja Sprint 7 (kolom schema
 * PRD hanya punya `cover_url`; tanpa kolom ikon baru).
 */
export function isImageUrl(cover: string | null | undefined): boolean {
  if (!cover) return false
  return cover.startsWith('http') || cover.startsWith('/') || cover.startsWith('data:')
}

/** Nama ikon FontAwesome dari cover (fallback daun). */
export function coverIcon(cover: string | null | undefined): string {
  if (!cover || isImageUrl(cover)) return 'fa-leaf'
  return cover
}

/** Hitungan header "N pelajaran · kuis" sesuai mockup kartu modul. */
export function moduleCountLabel(module: ModuleCard): string {
  const base = `${module.lesson_count} pelajaran`
  return module.quiz_question_count > 0 ? `${base} · kuis` : base
}

/** Chip header layar: "2/6 modul". */
export function headerSummary(completed: number, total: number): string {
  return `${completed}/${total} modul`
}

/** Subjudul layar pelajaran: "Pelajaran 2 dari 4". */
export function lessonPosition(order: number, total: number): string {
  return `Pelajaran ${Math.min(order + 1, Math.max(total, 1))} dari ${total}`
}

/** Intro kuis: "5 soal · lulus 70% · hadiah +20 poin". */
export function quizIntroLine(
  questionCount: number,
  passPercent: number,
  points: number,
): string {
  return `${questionCount} soal · lulus ${passPercent}% · hadiah +${points} poin`
}

/** Titik progres kuis (mockup `quiz-progress`): done untuk soal terjawab. */
export function quizDots(total: number, answered: number): boolean[] {
  return Array.from({ length: Math.max(total, 0) }, (_, i) => i < answered)
}

/** Judul ring hasil sesuai mockup. */
export function resultTitle(passed: boolean): string {
  return passed ? 'MasyaAllah, Lulus!' : 'Belum Lulus'
}

/** Label kecil di bawah angka ring: "LULUS" / persen ambang. */
export function resultRingLabel(passed: boolean, passPercent: number): string {
  return passed ? 'LULUS' : `MIN. ${passPercent}%`
}

/** Pesan hasil utama: poin masuk / sudah pernah / ajakan coba lagi. */
export function resultPointsLine(
  passed: boolean,
  pointsAwarded: number,
  alreadyPassedBefore: boolean,
): string {
  if (!passed) return 'Pelajari kembali materinya lalu coba lagi — poin menunggumu.'
  if (pointsAwarded > 0) return `+${pointsAwarded} poin masuk ke dompet kebaikanmu.`
  if (alreadyPassedBefore) return 'Poin kuis modul ini sudah kamu rebut sebelumnya.'
  return 'Kuis selesai.'
}

/** Label ikon FontAwesome per tipe blok (tip = lampu, quote = kutipan). */
export function blockIcon(block: Pick<LessonBlock, 'type'>): string {
  switch (block.type) {
    case 'tip':
      return 'fa-lightbulb'
    case 'quote':
      return 'fa-quote-right'
    default:
      return ''
  }
}
