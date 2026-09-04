/** Service Misi (Sprint 4) — pembungkus endpoint `/v1/missions*` & `/v1/badges`. */

import { api } from '@/api/client'
import type { BadgeItem, ClaimResponse, Mission, MissionsPage } from '@/types/mission'

/** Daftar misi aktif + klaim saya + ringkasan mingguan — `GET /v1/missions`. */
export function fetchMissions(): Promise<MissionsPage> {
  return api<MissionsPage>('/v1/missions')
}

/** Klaim misi photo: unggah bukti → antrian verifikasi — `POST /v1/missions/{id}/claim`. */
export function claimPhoto(missionId: number, photo: Blob, consent: boolean): Promise<ClaimResponse> {
  const formData = new FormData()
  formData.append('consent', consent ? 'true' : 'false')
  formData.append('file', photo, 'bukti-misi.jpg')
  return api<ClaimResponse>(`/v1/missions/${missionId}/claim`, { method: 'POST', formData })
}

/** Lencana tab Pencapaian — `GET /v1/badges`. */
export function fetchBadges(): Promise<BadgeItem[]> {
  return api<BadgeItem[]>('/v1/badges')
}

export type { Mission }
