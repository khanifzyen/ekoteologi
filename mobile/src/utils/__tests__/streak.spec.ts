/** Unit test helper kartu streak (Sprint 5) — `utils/streak.ts`. */

import { describe, expect, it } from 'vitest'

import type { StreakDay } from '@/types/streak'
import { dayInitial, streakAriaLabel, streakHint, streakTitle } from '@/utils/streak'

function makeWeek(actives: boolean[]): StreakDay[] {
  // 7 hari berakhir 2026-09-04 (Jumat).
  return actives.map((active, index) => {
    const d = new Date(2026, 8, 4 - (actives.length - 1 - index))
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { date: iso, active }
  })
}

describe('dayInitial', () => {
  it('inisial Indonesia: Jumat=J, Sabtu=S, Minggu=M', () => {
    expect(dayInitial('2026-09-04')).toBe('J') // Jumat
    expect(dayInitial('2026-09-05')).toBe('S') // Sabtu
    expect(dayInitial('2026-09-06')).toBe('M') // Minggu
    expect(dayInitial('2026-09-07')).toBe('S') // Senin
    expect(dayInitial('bukan-tanggal')).toBe('·')
  })
})

describe('streakTitle', () => {
  it('nol → ajakan memulai; positif → hitungan hari', () => {
    expect(streakTitle(0)).toBe('Mulai streakmu hari ini')
    expect(streakTitle(5)).toBe('Streak 5 hari!')
  })
})

describe('streakHint', () => {
  const base = { currentStreak: 5, activeToday: false, daysToBonus: 1, bonusPoints: 20, bonusEveryDays: 6 }

  it('teks bonus sesuai mockup beranda.html', () => {
    expect(streakHint(base)).toBe('Jangan putus — 1 hari lagi untuk bonus +20 poin.')
  })

  it('bonus lebih jauh & sudah aktif hari ini', () => {
    expect(
      streakHint({ ...base, activeToday: true, daysToBonus: 3 }),
    ).toBe('Jangan putus — 3 hari lagi untuk bonus +20 poin.')
  })

  it('bonus baru diraih hari ini → pesan bonus berikutnya', () => {
    expect(
      streakHint({ ...base, activeToday: true, daysToBonus: 6 }),
    ).toBe('Aktif hari ini — bonus +20 poin menunggumu 6 hari lagi.')
  })

  it('streak nol → ajakan aksi pertama', () => {
    expect(streakHint({ ...base, currentStreak: 0 })).toBe(
      'Scan sampah atau selesaikan misi hari ini untuk memulai streak.',
    )
  })

  it('bonus dimatikan (0) → pesan konsistensi polos', () => {
    expect(streakHint({ ...base, bonusPoints: 0, activeToday: true })).toBe(
      'Aktif hari ini — teruskan konsistensimu!',
    )
    expect(streakHint({ ...base, bonusPoints: 0, activeToday: false })).toBe(
      'Aktifkan hari ini agar streak tidak putus.',
    )
  })
})

describe('streakAriaLabel', () => {
  it('menghitung hari aktif utk pembaca layar', () => {
    const week = makeWeek([false, false, false, true, true, true, true])
    expect(streakAriaLabel(4, week)).toBe('Streak 4 hari terakhir — 4 dari 7 hari aktif')
    expect(streakAriaLabel(0, week)).toBe('Streak belum berjalan — 4 dari 7 hari terakhir aktif')
  })
})
