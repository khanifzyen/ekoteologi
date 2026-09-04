/** Tipe streak harian (Sprint 5) — kontrak `GET /v1/streak`. */

export interface StreakDay {
  /** Tanggal ISO (YYYY-MM-DD). */
  date: string
  active: boolean
}

export interface StreakStatus {
  current_streak: number
  longest_streak: number
  active_today: boolean
  last_active_date: string | null
  bonus_points: number
  bonus_every_days: number
  days_to_bonus: number
  /** 7 hari terakhir, elemen terakhir = hari ini. */
  week: StreakDay[]
}
