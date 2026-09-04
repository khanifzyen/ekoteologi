/** Test util e-learning (Sprint 7) — mikrokonteks kartu/blok/ring hasil. */

import { describe, expect, it } from 'vitest'

import type { LessonBlock, ModuleCard } from '@/types/elearning'
import {
  blockIcon,
  coverIcon,
  headerSummary,
  isImageUrl,
  lessonPosition,
  moduleCountLabel,
  modulePercent,
  progressLabel,
  quizDots,
  quizIntroLine,
  resultPointsLine,
  resultRingLabel,
  resultTitle,
} from '@/utils/elearning'

function card(progress: Partial<ModuleCard['progress']>, extra: Partial<ModuleCard> = {}): ModuleCard {
  return {
    id: 1,
    title: 'Modul',
    slug: 'modul',
    description: null,
    cover_url: null,
    order: 1,
    lesson_count: 4,
    quiz_question_count: 5,
    quiz_points: 20,
    cta: 'Mulai',
    progress: {
      lessons_done: 0,
      total_lessons: 4,
      percent: 0,
      is_completed: false,
      ...progress,
    },
    ...extra,
  }
}

describe('progressLabel / modulePercent', () => {
  it('Baru saat 0 persen', () => {
    expect(progressLabel(card({ percent: 0, lessons_done: 0 }))).toBe('Baru')
  })
  it('persen di tengah', () => {
    expect(progressLabel(card({ percent: 50, lessons_done: 2 }))).toBe('50%')
  })
  it('Selesai saat is_completed', () => {
    expect(progressLabel(card({ percent: 100, lessons_done: 4, is_completed: true }))).toBe(
      'Selesai',
    )
  })
  it('modulePercent dijepit 0–100', () => {
    expect(modulePercent(card({ percent: 120 }))).toBe(100)
    expect(modulePercent(card({ percent: -5 }))).toBe(0)
  })
})

describe('cover', () => {
  it('URL gambar terdeteksi', () => {
    expect(isImageUrl('https://x/y.png')).toBe(true)
    expect(isImageUrl('/uploads/x.png')).toBe(true)
    expect(isImageUrl('fa-leaf')).toBe(false)
    expect(isImageUrl(null)).toBe(false)
  })
  it('ikon FontAwesome dipakai langsung, fallback daun', () => {
    expect(coverIcon('fa-recycle')).toBe('fa-recycle')
    expect(coverIcon('https://x/y.png')).toBe('fa-leaf')
    expect(coverIcon(null)).toBe('fa-leaf')
  })
})

describe('label mikrokonteks', () => {
  it('hitungan kartu "4 pelajaran · kuis" / tanpa kuis', () => {
    expect(moduleCountLabel(card({}))).toBe('4 pelajaran · kuis')
    expect(moduleCountLabel(card({}, { quiz_question_count: 0 }))).toBe('4 pelajaran')
  })
  it('chip header "2/6 modul"', () => {
    expect(headerSummary(2, 6)).toBe('2/6 modul')
  })
  it('posisi pelajaran "Pelajaran 2 dari 4"', () => {
    expect(lessonPosition(1, 4)).toBe('Pelajaran 2 dari 4')
    expect(lessonPosition(3, 4)).toBe('Pelajaran 4 dari 4')
  })
  it('baris intro kuis sesuai mockup', () => {
    expect(quizIntroLine(5, 70, 20)).toBe('5 soal · lulus 70% · hadiah +20 poin')
  })
})

describe('kuis', () => {
  it('titik progres: terjawab = done', () => {
    expect(quizDots(3, 1)).toEqual([true, false, false])
    expect(quizDots(0, 0)).toEqual([])
  })
  it('judul ring hasil', () => {
    expect(resultTitle(true)).toBe('MasyaAllah, Lulus!')
    expect(resultTitle(false)).toBe('Belum Lulus')
  })
  it('label ring: LULUS / ambang', () => {
    expect(resultRingLabel(true, 70)).toBe('LULUS')
    expect(resultRingLabel(false, 70)).toBe('MIN. 70%')
  })
  it('baris poin hasil untuk tiap keadaan', () => {
    expect(resultPointsLine(true, 20, false)).toBe('+20 poin masuk ke dompet kebaikanmu.')
    expect(resultPointsLine(true, 0, true)).toContain('sudah kamu rebut')
    expect(resultPointsLine(false, 0, false)).toContain('coba lagi')
  })
})

describe('blok konten', () => {
  it('ikon tip = lampu; paragraph tanpa ikon', () => {
    const tip: LessonBlock = { type: 'tip', text: 'x' }
    const para: LessonBlock = { type: 'paragraph', text: 'x' }
    const quote: LessonBlock = { type: 'quote', text: 'x' }
    expect(blockIcon(tip)).toBe('fa-lightbulb')
    expect(blockIcon(quote)).toBe('fa-quote-right')
    expect(blockIcon(para)).toBe('')
  })
})
