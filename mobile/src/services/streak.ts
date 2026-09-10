/** Service streak harian (Sprint 5 → Sprint 10: field `users` + koleksi `scans`). */

import { pb, toApiError } from '@/api/client'
import type { StreakStatus } from '@/types/streak'

/**
 * Bonus streak (paritas server lama — sprint 5: kelipatan 6 hari, +20 poin).
 * Engine streak (reset lazy, bonus ledger) hidup di hook Sprint 12; klien
 * hanya menampilkan status + kalender 7 hari dari aktivitas scan.
 */
const BONUS_POINTS = 20
const BONUS_EVERY_DAYS = 6

function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Status streak + kalender 7 hari utk kartu streak beranda. */
export async function fetchStreak(): Promise<StreakStatus> {
  try {
    const week: { date: string; active: boolean }[] = []
    const since = new Date()
    since.setDate(since.getDate() - 6)
    since.setHours(0, 0, 0, 0)
    const scans = await pb.collection('scans').getFullList<{ created?: string }>({
      filter: `created >= "${since.toISOString()}"`,
      fields: 'id,created',
    })
    const activeDays = new Set(scans.map((s) => (s.created ?? '').slice(0, 10)))
    for (let i = 6; i >= 0; i--) {
      const day = new Date()
      day.setDate(day.getDate() - i)
      const date = isoDate(day)
      week.push({ date, active: activeDays.has(date) })
    }
    const record = pb.authStore.record as
      | { current_streak?: number; longest_streak?: number; last_active_date?: string }
      | null
    const todayIso = isoDate(new Date())
    const lastActive = (record?.last_active_date as string) || ''
    const currentStreak = Number(record?.current_streak ?? 0)
    const daysIntoCycle = BONUS_EVERY_DAYS > 0 ? currentStreak % BONUS_EVERY_DAYS : 0
    return {
      current_streak: currentStreak,
      longest_streak: Number(record?.longest_streak ?? 0),
      active_today: activeDays.has(todayIso) || lastActive.slice(0, 10) === todayIso,
      last_active_date: lastActive || null,
      bonus_points: BONUS_POINTS,
      bonus_every_days: BONUS_EVERY_DAYS,
      days_to_bonus: currentStreak > 0 ? (BONUS_EVERY_DAYS - daysIntoCycle) % BONUS_EVERY_DAYS : BONUS_EVERY_DAYS,
      week,
    }
  } catch (err) {
    throw toApiError(err)
  }
}
