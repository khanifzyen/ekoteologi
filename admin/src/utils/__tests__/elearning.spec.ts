/** Test util editor e-learning admin (Sprint 7). */

import { describe, expect, it } from 'vitest'

import {
  blocksSummary,
  emptyBlock,
  lessonError,
  optionLetter,
  questionError,
  slugPreview,
} from '@/utils/elearning'

describe('blok konten', () => {
  it('blok kosong per tipe — quote punya arab & sumber', () => {
    expect(emptyBlock('paragraph')).toEqual({ type: 'paragraph', text: '' })
    expect(emptyBlock('tip')).toEqual({ type: 'tip', text: '' })
    expect(emptyBlock('quote')).toEqual({ type: 'quote', text: '', arabic: '', source: '' })
  })
  it('ringkasan blok menghitung per tipe', () => {
    expect(
      blocksSummary([
        { type: 'paragraph', text: 'a' },
        { type: 'paragraph', text: 'b' },
        { type: 'quote', text: 'c' },
      ]),
    ).toBe('2 paragraf · 1 kutipan')
    expect(blocksSummary([])).toBe('kosong')
  })
})

describe('validasi pelajaran', () => {
  it('judul wajib', () => {
    expect(lessonError('  ', [{ type: 'paragraph', text: 'x' }])).toContain('Judul')
  })
  it('butuh minimal satu blok berisi', () => {
    expect(lessonError('Judul', [{ type: 'tip', text: ' ' }])).toContain('satu blok')
  })
  it('blok sah lolos', () => {
    expect(lessonError('Judul', [{ type: 'paragraph', text: 'Isi.' }])).toBe('')
  })
})

describe('validasi soal', () => {
  it('teks soal wajib', () => {
    expect(
      questionError({ question: ' ', options: ['A', 'B'], answer: 0, explanation: '' }),
    ).toContain('soal')
  })
  it('butuh dua pilihan terisi', () => {
    expect(
      questionError({ question: 'S?', options: ['A', ' '], answer: 0, explanation: '' }),
    ).toContain('dua pilihan')
  })
  it('kunci harus pilihan terisi', () => {
    expect(
      questionError({ question: 'S?', options: ['A', 'B'], answer: 2, explanation: '' }),
    ).toContain('Kunci')
  })
  it('soal sah lolos', () => {
    expect(
      questionError({ question: 'S?', options: ['A', 'B'], answer: 1, explanation: 'e' }),
    ).toBe('')
  })
})

describe('label & slug', () => {
  it('huruf pilihan A–D', () => {
    expect(optionLetter(0)).toBe('A')
    expect(optionLetter(3)).toBe('D')
  })
  it('pratinjau slug dari judul', () => {
    expect(slugPreview('Fiqih Sampah Sehari-hari!')).toBe('fiqih-sampah-sehari-hari')
  })
})
