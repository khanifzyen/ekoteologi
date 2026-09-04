/** Service konten harian (Sprint 6) — `GET /v1/daily-content`. */

import { api } from '@/api/client'
import type { DailyContent } from '@/types/daily'

/** Konten hari ini: terjadwal (admin) atau fallback bank quote terkurasi. */
export function fetchDailyContent(): Promise<DailyContent> {
  return api<DailyContent>('/v1/daily-content')
}
