/** Tipe kontrak Scan AI (Sprint 3) — cermin `api/app/schemas/scan.py`. */

export interface ScanQuote {
  text: string
  source: string
}

export interface ScanCategory {
  id: number
  name: string
  icon: string | null
}

export interface ScanCategoryFull extends ScanCategory {
  base_points: number
}

/** Respons `POST /v1/scan` (kontrak final Sprint 2). */
export interface ScanResult {
  id: number
  item_name: string
  category: ScanCategory
  advice: string
  quote: ScanQuote
  points: number
  points_total: number
  cached: boolean
  duplicate: boolean
  image_url: string | null
  created_at: string
}

/** Satu baris riwayat (`GET /v1/scans`). */
export interface ScanHistoryItem {
  id: number
  item_name: string | null
  category: ScanCategory | null
  points: number
  image_url: string | null
  created_at: string
}

export interface ScanHistoryPage {
  items: ScanHistoryItem[]
  total: number
  limit: number
  offset: number
}

/** Kuota harian (`GET /v1/scans/quota`). */
export interface ScanQuota {
  used: number
  limit: number
  remaining: number
  resets_in_seconds: number
}
