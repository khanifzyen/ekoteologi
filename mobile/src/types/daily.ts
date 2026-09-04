/** Tipe konten harian (Sprint 6) — kontrak `GET /v1/daily-content` (PRD §5.6). */

export interface DailyContent {
  date: string
  /** ayat | hadis | refleksi | fallback (dari bank quote — tanpa konten terjadwal). */
  type: string
  title: string | null
  body: string
  source: string | null
  /** "Aksi hari ini" — null saat fallback. */
  eco_action: string | null
  fallback: boolean
}
