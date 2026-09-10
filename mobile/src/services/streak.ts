/** Service streak harian (Sprint 5 → Sprint 12: route hook `GET /streak`). */

import { pb, toApiError } from '@/api/client'
import type { StreakStatus } from '@/types/streak'

/**
 * Sprint 12: streak dihitung hook server — reset lazy saat aktivitas, bonus
 * ledger setiap kelipatan `bonus_every_days` (env-driven), dan kalender 7
 * hari dari ledger poin (semua aktivitas bernilai, bukan hanya scan).
 * Konfigurasi bonus juga dikirim server agar tampilan selalu sinkron env.
 */
export async function fetchStreak(): Promise<StreakStatus> {
  try {
    const data = (await pb.send('/api/ekoteologi/streak', {
      method: 'GET',
      requestKey: null,
    })) as Record<string, unknown>
    const week = Array.isArray(data.week) ? data.week : []
    return {
      current_streak: Number(data.current_streak ?? 0),
      longest_streak: Number(data.longest_streak ?? 0),
      active_today: data.active_today === true,
      last_active_date: (data.last_active_date as string) || null,
      bonus_points: Number(data.bonus_points ?? 0),
      bonus_every_days: Number(data.bonus_every_days ?? 0),
      days_to_bonus: Number(data.days_to_bonus ?? 0),
      week: week.map((d) => ({
        date: String((d as { date?: string }).date ?? ''),
        active: (d as { active?: boolean }).active === true,
      })),
    }
  } catch (err) {
    throw toApiError(err)
  }
}
