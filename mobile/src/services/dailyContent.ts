/** Service konten harian (Sprint 6 → Sprint 13: route hook PocketBase). */

import { pb, toApiError } from '@/api/client'
import type { DailyContent } from '@/types/daily'

/**
 * Bank quote lokal — HANYA utk luring (server route `GET /api/ekoteologi/
 * daily-content` selalu 200: konten terjadwal admin, auto-publish cron, atau
 * fallback bank terkurasi server — satu sumber dgn scan).
 */
const OFFLINE_BANK: Array<Pick<DailyContent, 'type' | 'body' | 'source'>> = [
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

/** Konten hari ini: server (terjadwal/auto-publish/fallback) atau bank luring. */
export async function fetchDailyContent(): Promise<DailyContent> {
  try {
    const data = await pb.send<DailyContent>('/api/ekoteologi/daily-content', {
      method: 'GET',
      requestKey: null,
    })
    return {
      date: data.date,
      type: data.type,
      title: data.title ?? null,
      body: data.body,
      source: data.source ?? null,
      eco_action: data.eco_action ?? null,
      fallback: !!data.fallback,
    }
  } catch (err) {
    // Luring/gangguan jaringan → bank lokal (UI tetap menampilkan kartu);
    // error aplikasi lain diteruskan agar state error tampil.
    const e = toApiError(err)
    if (e.status !== 0) throw e
    const pick = OFFLINE_BANK[new Date().getDate() % OFFLINE_BANK.length]
    return {
      ...pick,
      date: new Date().toISOString().slice(0, 10),
      title: null,
      eco_action: null,
      fallback: true,
    }
  }
}
