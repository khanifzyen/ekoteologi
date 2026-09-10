/** Service notifikasi in-app (Sprint 5 → Sprint 13: realtime SSE PocketBase). */

import { pb, toApiError } from '@/api/client'
import type { NotificationItem, NotificationType, NotificationsPage } from '@/types/notification'

/**
 * Realtime memakai SSE bawaan PocketBase (`/api/realtime`) via SDK
 * `pb.collection('notifications').subscribe` — notifikasi baru (hasil
 * verifikasi, bonus streak, reminder cron, broadcast admin, poin kuis)
 * tampil TANPA polling. Push FCM ke perangkat dikirim hook server
 * (pb_hooks/push.pb.js) dari baris notifikasi yang sama. `unread_count`
 * dihitung dari total baris yang belum dibaca.
 */
export async function fetchNotifications(
  options: { type?: string; limit?: number } = {},
): Promise<NotificationsPage> {
  const limit = options.limit ?? 20
  const filters: string[] = []
  if (options.type) filters.push(`type = "${options.type}"`)
  const filter = filters.length ? filters.join(' && ') : ''
  try {
    const [page, unread] = await Promise.all([
      pb.collection('notifications').getList<Record<string, unknown>>(1, limit, {
        filter,
        sort: '-created',
      }),
      pb.collection('notifications').getList(1, 1, {
        filter: filter ? `${filter} && read_at = ""` : 'read_at = ""',
        fields: 'id',
      }),
    ])
    const items: NotificationItem[] = page.items.map((row) => ({
      id: String(row.id),
      title: (row.title as string) || null,
      body: (row.body as string) || null,
      type: ((row.type as string) || null) as NotificationType | null,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      read_at: (row.read_at as string) || null,
      created_at: String(row.created ?? ''),
    }))
    return { items, total: page.totalItems, unread_count: unread.totalItems, limit, offset: 0 }
  } catch (err) {
    throw toApiError(err)
  }
}

/** Tandai satu notifikasi dibaca — broadcast (user kosong) best-effort saja. */
export async function markNotificationRead(id: string): Promise<void> {
  try {
    await pb.collection('notifications').update(id, { read_at: new Date().toISOString() })
  } catch {
    /* broadcast tidak bisa diubah pemilik — abaikan (guard server read_at) */
  }
}

/** Tandai semua notifikasi milik user dibaca (broadcast best-effort). */
export async function markAllNotificationsRead(): Promise<void> {
  try {
    const rows = await pb.collection('notifications').getFullList<Record<string, unknown>>({
      filter: 'read_at = ""',
      fields: 'id',
    })
    await Promise.all(rows.map((row) => markNotificationRead(String(row.id))))
  } catch (err) {
    throw toApiError(err)
  }
}

export interface RealtimeNotification {
  action: string
  item: NotificationItem
}

/**
 * Berlangganan realtime notifikasi milik user + broadcast (rule koleksi
 * membatasi apa yang diterima). Return fungsi berhenti-langganan; callback
 * dipanggil untuk aksi create/update miliknya. Gagal koneksi (offline)
 * dilempar ke callback onError tanpa mematikan aplikasi.
 */
export async function subscribeNotifications(
  onEvent: (event: RealtimeNotification) => void,
  onError?: (err: unknown) => void,
): Promise<() => Promise<void>> {
  const unsubscribe = await pb.collection('notifications').subscribe('*', (msg) => {
    try {
      const row = msg.record as Record<string, unknown>
      onEvent({
        action: msg.action,
        item: {
          id: String(row.id ?? ''),
          title: (row.title as string) || null,
          body: (row.body as string) || null,
          type: ((row.type as string) || null) as NotificationType | null,
          payload: (row.payload as Record<string, unknown> | null) ?? null,
          read_at: (row.read_at as string) || null,
          created_at: String(row.created ?? ''),
        },
      })
    } catch (err) {
      onError?.(err)
    }
  })
  return async () => {
    await unsubscribe()
  }
}
