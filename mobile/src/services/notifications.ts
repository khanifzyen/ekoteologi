/** Service notifikasi in-app (Sprint 5) — `GET /v1/notifications` + tandai dibaca. */

import { api } from '@/api/client'
import type { NotificationsPage } from '@/types/notification'

/** Daftar notifikasi milik user + `unread_count` — `GET /v1/notifications`. */
export function fetchNotifications(options: { type?: string; limit?: number } = {}): Promise<NotificationsPage> {
  const params = new URLSearchParams()
  if (options.type) params.set('type', options.type)
  if (options.limit) params.set('limit', String(options.limit))
  const query = params.toString()
  return api<NotificationsPage>(`/v1/notifications${query ? `?${query}` : ''}`)
}

/** Tandai satu notifikasi dibaca — `POST /v1/notifications/{id}/read`. */
export function markNotificationRead(id: number): Promise<void> {
  return api<void>(`/v1/notifications/${id}/read`, { method: 'POST' })
}

/** Tandai semua notifikasi dibaca — `POST /v1/notifications/read`. */
export function markAllNotificationsRead(): Promise<void> {
  return api<void>('/v1/notifications/read', { method: 'POST' })
}
