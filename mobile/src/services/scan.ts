/** Service Scan AI (Sprint 3) — pembungkus endpoint `/v1/scan*` di API. */

import { api } from '@/api/client'
import type { ScanCategoryFull, ScanHistoryPage, ScanQuota, ScanResult } from '@/types/scan'

/** Kirim foto (JPEG dari kamera/galeri) untuk dianalisis — `POST /v1/scan`. */
export function submitScan(photo: Blob, filename = 'scan.jpg'): Promise<ScanResult> {
  const formData = new FormData()
  formData.append('file', photo, filename)
  return api<ScanResult>('/v1/scan', { method: 'POST', formData })
}

export interface HistoryQuery {
  categoryId?: number
  limit?: number
  offset?: number
}

/** Riwayat scan milik user — `GET /v1/scans`. */
export function fetchHistory(query: HistoryQuery = {}): Promise<ScanHistoryPage> {
  const params = new URLSearchParams()
  if (query.categoryId !== undefined) params.set('category_id', String(query.categoryId))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  const qs = params.toString()
  return api<ScanHistoryPage>(`/v1/scans${qs ? `?${qs}` : ''}`)
}

/** Daftar kategori sampah (seed) utk filter chips — `GET /v1/scans/categories`. */
export function fetchCategories(): Promise<ScanCategoryFull[]> {
  return api<ScanCategoryFull[]>('/v1/scans/categories')
}

/** Kuota scan hari ini (tanpa mengkonsumsi slot) — `GET /v1/scans/quota`. */
export function fetchQuota(): Promise<ScanQuota> {
  return api<ScanQuota>('/v1/scans/quota')
}
