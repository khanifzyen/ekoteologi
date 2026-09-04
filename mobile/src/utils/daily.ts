/**
 * Util konten harian (Sprint 6) — label tipe & teks bagikan utk kartu wisdom
 * `beranda.html` (fungsi murni, teruji).
 */

import type { DailyContent } from '@/types/daily'

const TYPE_LABELS: Record<string, string> = {
  ayat: 'Ayat',
  hadis: 'Hadis',
  refleksi: 'Refleksi',
  fallback: 'Kutipan',
}

/** Label chip tipe konten ("Ayat", "Hadis", "Refleksi", "Kutipan"). */
export function contentTypeLabel(type: string | null): string {
  if (!type) return 'Kutipan'
  return TYPE_LABELS[type] ?? 'Kutipan'
}

/** Teks utk dibagikan (Web Share API) — kutipan + sumber + tanda aplikasi. */
export function wisdomShareText(content: DailyContent): string {
  const lines = [`"${content.body}"`]
  if (content.source) lines.push(`— ${content.source}`)
  lines.push('', 'Dibagikan dari Ekoteologi AR')
  return lines.join('\n')
}

/** Bila perangkat mendukung Web Share API (fallback UI: salin/manual). */
export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}
