/** Tipe kontrak Scan AI (Sprint 3) — kini diisi dari koleksi PocketBase. */

export interface ScanQuote {
  text: string
  source: string
}

export interface ScanCategory {
  id: string
  name: string
  icon: string | null
}

export interface ScanCategoryFull extends ScanCategory {
  base_points: number
}

/**
 * Respons scan (kontrak UI Sprint 3). Sejak Sprint 10 foto tersimpan via API
 * koleksi `scans` (PocketBase); analisis LLM + poin menyusul di Sprint 11 —
 * hasil dengan `pending_ai = true` membawa null untuk kolom hasil AI.
 */
export interface ScanResult {
  id: string
  item_name: string
  category: ScanCategory | null
  advice: string
  quote: ScanQuote | null
  points: number
  points_total: number
  cached: boolean
  duplicate: boolean
  /** true: foto tersimpan, analisis AI + poin menyusul (Sprint 11). */
  pending_ai: boolean
  image_url: string | null
  created_at: string
}

/** Satu baris riwayat (`GET /v1/scans`). */
export interface ScanHistoryItem {
  id: string
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
