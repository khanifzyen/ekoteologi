/** Helper murni kartu streak (Sprint 5) — mudah diuji (vitest). */

import type { StreakDay } from '@/types/streak'

/** Inisial hari Indonesia: Min S, Sen S, Sel S, Rab R, Kam K, Jum J, Sab S. */
const DAY_INITIALS = ['M', 'S', 'S', 'R', 'K', 'J', 'S'] as const

/** Inisial satu huruf utk lingkaran kalender (getDay: 0=Minggu). */
export function dayInitial(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return '·'
  return DAY_INITIALS[date.getDay()]
}

/** Judul kartu streak. */
export function streakTitle(currentStreak: number): string {
  if (currentStreak <= 0) return 'Mulai streakmu hari ini'
  return `Streak ${currentStreak} hari!`
}

export interface StreakHintInput {
  currentStreak: number
  activeToday: boolean
  daysToBonus: number
  bonusPoints: number
  bonusEveryDays: number
}

/** Kalimat motivasi di bawah judul — gaya mockup `beranda.html`. */
export function streakHint(input: StreakHintInput): string {
  const { currentStreak, activeToday, daysToBonus, bonusPoints, bonusEveryDays } = input
  if (currentStreak <= 0) {
    return 'Scan sampah atau selesaikan misi hari ini untuk memulai streak.'
  }
  if (bonusPoints > 0 && bonusEveryDays > 0) {
    if (activeToday && daysToBonus === bonusEveryDays) {
      return `Aktif hari ini — bonus +${bonusPoints} poin menunggumu ${daysToBonus} hari lagi.`
    }
    if (daysToBonus > 0) {
      return `Jangan putus — ${daysToBonus} hari lagi untuk bonus +${bonusPoints} poin.`
    }
  }
  return activeToday
    ? 'Aktif hari ini — teruskan konsistensimu!'
    : 'Aktifkan hari ini agar streak tidak putus.'
}

/** Label aksesibilitas kalender 7 hari. */
export function streakAriaLabel(currentStreak: number, week: StreakDay[]): string {
  const activeCount = week.filter((day) => day.active).length
  if (currentStreak <= 0) return `Streak belum berjalan — ${activeCount} dari ${week.length} hari terakhir aktif`
  return `Streak ${currentStreak} hari terakhir — ${activeCount} dari ${week.length} hari aktif`
}
