/** Unit test helper layar Verifikasi (Sprint 5) — `utils/verification.ts`. */

import { describe, expect, it } from 'vitest'

import {
  claimSubtitle,
  formatUploaded,
  historyLabel,
  missionTypeLabel,
  nextIndexAfterRemove,
  reviewError,
  verificationLabel,
} from '@/utils/verification'

describe('reviewError', () => {
  it('menolak tanpa catatan diblokir dengan pesan (AUDIT.md A2)', () => {
    expect(reviewError('rejected', '')).toContain('catatan')
    expect(reviewError('rejected', '   ')).toContain('catatan')
  })

  it('approve boleh tanpa catatan; reject dgn catatan lolos', () => {
    expect(reviewError('approved', '')).toBe('')
    expect(reviewError('rejected', 'foto buram')).toBe('')
  })
})

describe('label', () => {
  it('sub-judul panel sesuai mockup', () => {
    expect(claimSubtitle({ type: 'weekly', verification: 'photo', points: 50 })).toBe(
      'Mingguan · verifikasi foto · +50 poin',
    )
    expect(claimSubtitle({ type: 'daily', verification: 'auto_scan', points: 15 })).toBe(
      'Harian · otomatis dari scan · +15 poin',
    )
    expect(missionTypeLabel('special')).toBe('Spesial')
    expect(verificationLabel('manual')).toBe('manual')
  })
})

describe('historyLabel', () => {
  it('klaim pertama vs klaim ke-N', () => {
    expect(historyLabel(1)).toBe('Klaim pertama pengguna ini')
    expect(historyLabel(12)).toBe('Misi ke-12 pengguna ini')
  })
})

describe('formatUploaded', () => {
  it('Hari ini / Kemarin / tanggal', () => {
    const now = new Date('2026-09-04T10:00:00')
    expect(formatUploaded('2026-09-04T09:12:00', now)).toContain('Hari ini')
    expect(formatUploaded('2026-09-04T09:12:00', now)).toContain('09.12')
    expect(formatUploaded('2026-09-03T21:40:00', now)).toContain('Kemarin')
    expect(formatUploaded('2026-09-01T08:00:00', now)).toContain('1 Sep')
    expect(formatUploaded(null)).toBe('—')
  })
})

describe('nextIndexAfterRemove', () => {
  it('tetap di posisi kecuali di ujung kanan', () => {
    expect(nextIndexAfterRemove(2, 5)).toBe(2)
    expect(nextIndexAfterRemove(4, 4)).toBe(3)
    expect(nextIndexAfterRemove(0, 0)).toBe(0)
  })
})
