/** Tipe notifikasi in-app (Sprint 5) — kontrak `GET /v1/notifications`. */

export type NotificationType = 'mission' | 'streak' | 'info' | 'reward'

export interface NotificationItem {
  id: number
  title: string | null
  body: string | null
  type: NotificationType | null
  payload: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

export interface NotificationsPage {
  items: NotificationItem[]
  total: number
  unread_count: number
  limit: number
  offset: number
}
