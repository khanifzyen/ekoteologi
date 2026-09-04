/** Tipe misi & lencana (Sprint 4) — kontrak `GET /v1/missions`, klaim, `/v1/badges`. */

export type MissionVerification = 'photo' | 'auto_scan' | 'manual'

export interface MissionClaim {
  id: number
  status: 'in_progress' | 'pending' | 'approved' | 'rejected'
  progress_count: number
  points_awarded: number
  review_note: string | null
  submitted_at: string | null
}

export interface Mission {
  id: number
  title: string
  description: string | null
  type: 'daily' | 'weekly' | 'special'
  icon: string | null
  points: number
  verification: MissionVerification
  required_count: number
  start_at: string | null
  end_at: string | null
  /** Klaim saya pada periode berjalan (null = belum diklaim). */
  my_claim: MissionClaim | null
}

export interface WeekSummary {
  week_done: number
  week_total: number
  week_points: number
}

export interface MissionsPage {
  items: Mission[]
  summary: WeekSummary
}

export interface BadgeItem {
  id: number
  code: string
  name: string | null
  icon: string | null
  description: string | null
  earned: boolean
  earned_at: string | null
}

export interface ClaimResponse {
  claim: MissionClaim
  message: string
}
