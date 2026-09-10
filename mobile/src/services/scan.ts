/** Service Scan AI (Sprint 3 → Sprint 10: koleksi `scans` PocketBase). */

import { currentUserId, fileUrl, pb, toApiError, type ApiError } from '@/api/client'
import type { ScanCategoryFull, ScanHistoryPage, ScanQuota, ScanResult } from '@/types/scan'

/** PRD §6 #2: rate limit scan 20/user/hari (pemeriksaan hook menyusul Sprint 11). */
export const SCAN_DAILY_LIMIT = 20

function meFilter(extra = ''): string {
  const uid = currentUserId()
  return extra ? `user = "${uid}" && ${extra}` : `user = "${uid}"`
}

/**
 * Kirim foto untuk dianalisis. Sprint 10: foto tersimpan sebagai record
 * `scans` (field file `image`); analisis LLM, kategori, saran, dan poin
 * diisi hook scan pada Sprint 11 — sementara hasil bertanda `pending_ai`.
 */
export async function submitScan(photo: Blob, filename = 'scan.jpg'): Promise<ScanResult> {
  const uid = currentUserId()
  const form = new FormData()
  form.append('user', uid)
  form.append('image', photo, filename)
  let record: Record<string, unknown>
  try {
    record = (await pb.collection('scans').create(form)) as Record<string, unknown>
  } catch (err) {
    throw toApiError(err)
  }
  const auth = pb.authStore.record as { points?: number } | null
  return {
    id: String(record.id),
    item_name: 'Objek belum dianalisis',
    category: null,
    advice: 'Foto sampahmu sudah tersimpan. Analisis AI (nama objek, saran pilah, dan poin) hadir di pembaruan berikutnya.',
    quote: null,
    points: 0,
    points_total: Number(auth?.points ?? 0),
    cached: false,
    duplicate: false,
    pending_ai: true,
    image_url: fileUrl(record as { id: string }, record.image as string),
    created_at: String(record.created ?? new Date().toISOString()),
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

/** Kuota scan hari ini — dihitung dari jumlah scan hari ini (tanpa mengunci). */
export async function fetchQuota(): Promise<ScanQuota> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  try {
    const page = await pb.collection('scans').getList(1, 1, {
      filter: meFilter(`created >= "${start.toISOString()}"`),
      fields: 'id',
    })
    const used = page.totalItems
    return {
      used,
      limit: SCAN_DAILY_LIMIT,
      remaining: Math.max(0, SCAN_DAILY_LIMIT - used),
      resets_in_seconds: Math.max(
        0,
        Math.floor((start.getTime() + 24 * 3600 * 1000 - Date.now()) / 1000),
      ),
    }
  } catch (err) {
    throw toApiError(err)
  }
}

export type { ApiError }
