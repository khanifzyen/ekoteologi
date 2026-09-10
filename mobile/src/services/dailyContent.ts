/** Service konten harian (Sprint 6 → Sprint 10: koleksi `daily_contents`). */

import { pb, toApiError } from '@/api/client'
import type { DailyContent } from '@/types/daily'

/**
 * Bank quote fallback (paritas server lama) — tampil bila tidak ada konten
 * terjadwal untuk hari ini (admin mengelola jadwal via panel Konten Harian).
 */
const FALLBACK_BANK: Array<Pick<DailyContent, 'type' | 'body' | 'source'>> = [
  {
    type: 'hadis',
    body: 'Dunia itu hijau dan manis, dan Allah menjadikan kalian khalifah di atasnya — maka lihatlah bagaimana kalian berbuat.',
    source: 'HR. Muslim',
  },
  {
    type: 'refleksi',
    body: 'Bumi bukan warisan dari leluhur, melainkan titipan untuk anak cucu — jagalah ia dengan amal kecil yang konsisten.',
    source: 'Kutipan Ekoteologi',
  },
  {
    type: 'ayat',
    body: 'Dan janganlah kamu berbuat kerusakan di bumi setelah (diciptakan) dengan baik.',
    source: 'QS. Al-A\u2019raf: 56',
  },
]

/** Konten hari ini: terjadwal (admin) atau fallback bank quote terkurasi. */
export async function fetchDailyContent(): Promise<DailyContent> {
  let pick: Pick<DailyContent, 'type' | 'body' | 'source'>
  try {
    const page = await pb.collection('daily_contents').getList<Record<string, unknown>>(1, 1, {
      sort: '-publish_date',
    })
    const row = page.items[0]
    if (row) {
      return {
        date: String(row.publish_date ?? new Date().toISOString().slice(0, 10)),
        type: String(row.type ?? 'refleksi'),
        title: (row.title as string) || null,
        body: String(row.body ?? ''),
        source: (row.source as string) || null,
        eco_action: (row.eco_action as string) || null,
        fallback: false,
      }
    }
    pick = FALLBACK_BANK[new Date().getDate() % FALLBACK_BANK.length]
  } catch (err) {
    // Luring/gangguan server → lempar agar UI menampilkan state error;
    // server hidup tanpa konten terjadwal → pakai fallback bank.
    const e = toApiError(err)
    if (e.status === 0) throw e
    pick = FALLBACK_BANK[new Date().getDate() % FALLBACK_BANK.length]
  }
  return {
    ...pick,
    date: new Date().toISOString().slice(0, 10),
    title: null,
    eco_action: null,
    fallback: true,
  }
}
