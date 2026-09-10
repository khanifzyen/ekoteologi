/** Service Scan AI (Sprint 11 — route kustom `POST /api/ekoteologi/scan`). */

import { fileUrl, pb, toApiError, type ApiError } from '@/api/client'
import type { ScanCategoryFull, ScanHistoryPage, ScanQuota, ScanResult } from '@/types/scan'

/**
 * PRD §6 #2: batas harian untuk fallback tampilan bila route kuota gagal
 * dihubungi. Nilai resmi dibaca dari server (`GET /api/ekoteologi/scan/quota`,
 * env `SCAN_DAILY_LIMIT`).
 */
export const SCAN_DAILY_LIMIT = 20

function meFilter(extra = ''): string {
  const uid = pb.authStore.record?.id ?? ''
  return extra ? `user = "${uid}" && ${extra}` : `user = "${uid}"`
}

/** Bentuk respons route scan (paritas ScanResponse FastAPI). */
interface ScanRouteResponse {
  id: string
  item_name: string
  category: { id: string; name: string; icon: string | null }
  advice: string
  quote: { text: string; source: string }
  points: number
  points_total: number
  cached: boolean
  duplicate: boolean
  image: string
  created_at: string
}

/**
 * Kirim foto untuk dianalisis (Sprint 11): multipart ke route kustom hook —
 * auth wajib, validasi ukuran/tipe di server, hasil LLM tervalidasi, poin via
 * ledger, cache `llm_cache` (respons `cached: true` bila dari cache, dan
 * `duplicate: true` untuk foto byte-identikal di hari yang sama → poin 0).
 */
export async function submitScan(photo: Blob, filename = 'scan.jpg'): Promise<ScanResult> {
  const form = new FormData()
  form.append('image', photo, filename)
  let data: ScanRouteResponse
  try {
    // requestKey: null — unggahan scan tidak boleh ter-autocancel oleh SDK.
    data = (await pb.send('/api/ekoteologi/scan', {
      method: 'POST',
      body: form,
      requestKey: null,
    })) as ScanRouteResponse
  } catch (err) {
    throw toApiError(err)
  }
  return {
    id: String(data.id),
    item_name: String(data.item_name ?? 'Objek'),
    category: data.category
      ? {
          id: String(data.category.id),
          name: String(data.category.name),
          icon: data.category.icon ?? null,
        }
      : null,
    advice: String(data.advice ?? ''),
    quote: data.quote ? { text: String(data.quote.text), source: String(data.quote.source) } : null,
    points: Number(data.points ?? 0),
    points_total: Number(data.points_total ?? 0),
    cached: !!data.cached,
    duplicate: !!data.duplicate,
    image_url: fileUrl({ id: String(data.id), collectionName: 'scans' }, data.image),
    created_at: String(data.created_at ?? new Date().toISOString()),
  }
}

export interface HistoryQuery {
  categoryId?: string
  limit?: number
  offset?: number
}

/** Riwayat scan milik user (koleksi `scans`, rule ownership). */
export async function fetchHistory(query: HistoryQuery = {}): Promise<ScanHistoryPage> {
  const limit = query.limit ?? 20
  const offset = query.offset ?? 0
  const filters = [meFilter()]
  if (query.categoryId) filters.push(`category = "${query.categoryId}"`)
  try {
    const page = await pb.collection('scans').getList(Math.floor(offset / limit) + 1, limit, {
      filter: filters.join(' && '),
      sort: '-created',
      expand: 'category',
    })
    return {
      items: page.items.map((row) => {
        const record = row as unknown as Record<string, unknown> & {
          expand?: { category?: Record<string, unknown> }
        }
        const category = record.expand?.category ?? null
        return {
          id: String(record.id),
          item_name: (record.item_name as string) || null,
          category: category
            ? { id: String(category.id), name: String(category.name), icon: (category.icon as string) || null }
            : null,
          points: Number(record.points ?? 0),
          image_url: fileUrl(record as { id: string }, record.image as string),
          created_at: String(record.created ?? ''),
        }
      }),
      total: page.totalItems,
      limit,
      offset,
    }
  } catch (err) {
    throw toApiError(err)
  }
}

/** Daftar kategori sampah (seed publik) utk filter chips. */
export async function fetchCategories(): Promise<ScanCategoryFull[]> {
  try {
    const rows = await pb.collection('waste_categories').getFullList<Record<string, unknown>>({
      sort: 'name',
    })
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      icon: (row.icon as string) || null,
      base_points: Number(row.base_points ?? 0),
    }))
  } catch (err) {
    throw toApiError(err)
  }
}

/**
 * Kuota scan hari ini dari route hook (sumber resmi — penghitung server-side
 * `scan_quota:{uid}:{tanggal}`, env `SCAN_DAILY_LIMIT`; Sprint 11 menggantikan
 * hitungan klien Sprint 10).
 */
export async function fetchQuota(): Promise<ScanQuota> {
  try {
    const data = (await pb.send('/api/ekoteologi/scan/quota', { method: 'GET' })) as {
      used: number
      limit: number
      remaining: number
      resets_in_seconds: number
    }
    return {
      used: Number(data.used ?? 0),
      limit: Number(data.limit ?? SCAN_DAILY_LIMIT),
      remaining: Number(data.remaining ?? 0),
      resets_in_seconds: Number(data.resets_in_seconds ?? 0),
    }
  } catch (err) {
    throw toApiError(err)
  }
}

export type { ApiError }
