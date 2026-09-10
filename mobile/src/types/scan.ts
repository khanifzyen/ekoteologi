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
 * Respons scan (kontrak UI Sprint 3). Sejak Sprint 11 analisis LLM + poin
 * diisi route kustom hook (`POST /api/ekoteologi/scan`) langsung saat
 * unggah — foto → LLM → JSON tervalidasi → tersimpan + poin.
 */
export interface ScanResult {
  id: string
  item_name: string
  category: ScanCategory | null
  advice: string
  quote: ScanQuote | null
  points: number
  points_total: number
  /** true: hasil dari cache `llm_cache` (bukan panggilan LLM baru). */
  cached: boolean
  /** true: foto byte-identikal dari user sama di hari sama → poin 0. */
  duplicate: boolean
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
