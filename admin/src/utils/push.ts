/**
 * Util murni komposer push (Sprint 8) — validasi & label tanpa efek samping
 * sehingga bisa diuji vitest (pola util chart/verification/elearning).
 */

export interface SegmentStat {
  segment: string
  label: string
  recipients: number
  tokens: number
}

export interface BroadcastResult {
  id: number
  title: string
  body: string
  segment: string
  recipients: number
  tokens: number
  sent: number
}

export const TITLE_MIN = 4
export const TITLE_MAX = 64
export const BODY_MIN = 8
export const BODY_MAX = 300

/** Pesan validasi komposer — '' berarti sah (pola `reviewError`). */
export function composerError(title: string, body: string): string {
  if (title.trim().length < TITLE_MIN) {
    return `Judul minimal ${TITLE_MIN} karakter.`
  }
  if (title.trim().length > TITLE_MAX) {
    return `Judul maksimal ${TITLE_MAX} karakter.`
  }
  if (body.trim().length < BODY_MIN) {
    return `Isi pesan minimal ${BODY_MIN} karakter.`
  }
  if (body.trim().length > BODY_MAX) {
    return `Isi pesan maksimal ${BODY_MAX} karakter.`
  }
  return ''
}

/** Ringkasan hasil kirim utk toast/panel — angka via Intl id-ID. */
export function broadcastSummary(result: BroadcastResult): string {
  const fmt = new Intl.NumberFormat('id-ID')
  return `Terkirim ke ${fmt.format(result.sent)} dari ${fmt.format(result.tokens)} perangkat (${fmt.format(result.recipients)} penerima).`
}

/** Label baris riwayat: "4 Sep 2026, 09.15 · Semua pengguna aktif". */
export function historyLabel(createdIso: string, segmentLabel: string): string {
  const tanggal = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(createdIso))
  return `${tanggal} · ${segmentLabel}`
}
