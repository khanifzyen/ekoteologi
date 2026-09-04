/** Service gamifikasi (Sprint 5): streak harian — `GET /v1/streak`. */

import { api } from '@/api/client'
import type { StreakStatus } from '@/types/streak'

/** Status streak + kalender 7 hari utk kartu streak beranda. */
export function fetchStreak(): Promise<StreakStatus> {
  return api<StreakStatus>('/v1/streak')
}
