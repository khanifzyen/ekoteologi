/**
 * Util editor e-learning admin (Sprint 7) — logika murni editor blok
 * pelajaran & bank soal (teruji vitest; tampilan hanya merender hasilnya).
 */

/** Bentuk blok konten pelajaran (kontrak JSONB `lessons.content`). */
export interface LessonBlock {
  type: 'paragraph' | 'quote' | 'tip'
  text: string
  arabic?: string | null
  source?: string | null
}

export interface QuizQuestionDraft {
  question: string
  options: string[]
  answer: number
  explanation: string
}

export const BLOCK_TYPE_LABEL: Record<LessonBlock['type'], string> = {
  paragraph: 'Paragraf',
  quote: 'Kutipan',
  tip: 'Tip',
}

/** Blok kosong baru utk editor (tipe menentukan field yang tampil). */
export function emptyBlock(type: LessonBlock['type']): LessonBlock {
  if (type === 'quote') return { type, text: '', arabic: '', source: '' }
  return { type, text: '' }
}

/** Ringkasan blok utk daftar pelajaran: "2 paragraf · 1 kutipan". */
export function blocksSummary(blocks: LessonBlock[]): string {
  const counts: Record<string, number> = {}
  for (const block of blocks) {
    counts[block.type] = (counts[block.type] ?? 0) + 1
  }
  const parts = (['paragraph', 'quote', 'tip'] as const)
    .filter((type) => counts[type])
    .map((type) => `${counts[type]} ${BLOCK_TYPE_LABEL[type].toLowerCase()}`)
  return parts.length > 0 ? parts.join(' · ') : 'kosong'
}

/** Label pilihan A/B/C/D untuk radio kunci jawaban. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index)
}

/** Validasi draft soal — pesan galat Bahasa Indonesia atau '' bila sah. */
export function questionError(draft: QuizQuestionDraft): string {
  if (draft.question.trim().length === 0) return 'Teks soal wajib diisi.'
  const filled = draft.options.map((o) => o.trim()).filter((o) => o.length > 0)
  if (filled.length < 2) return 'Isi minimal dua pilihan jawaban.'
  if (draft.options.every((o) => o.trim().length === 0)) return 'Isi minimal dua pilihan jawaban.'
  const answerOption = draft.options[draft.answer]?.trim() ?? ''
  if (answerOption.length === 0) return 'Kunci jawaban harus salah satu pilihan yang terisi.'
  return ''
}

/** Validasi draft pelajaran — pesan galat atau '' bila sah. */
export function lessonError(title: string, blocks: LessonBlock[]): string {
  if (title.trim().length === 0) return 'Judul pelajaran wajib diisi.'
  const valid = blocks.filter((b) => b.text.trim().length > 0)
  if (valid.length === 0) return 'Isi minimal satu blok konten.'
  const invalid = blocks.find((b) => b.type === 'quote' && b.text.trim().length === 0)
  if (invalid) return 'Ada blok kutipan tanpa teks — isi atau hapus bloknya.'
  return ''
}

/** Pratinjau slug dari judul (server yang menentukan final). */
export function slugPreview(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200)
}
