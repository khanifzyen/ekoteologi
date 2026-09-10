/**
 * Auth store panel admin (Sprint 10 — PocketBase SDK).
 *
 * Login = `authWithPassword` koleksi `users` (bukan superuser); role guard
 * (`admin|verifier|editor`) tetap dievaluasi router. Sesi persist + refresh
 * otomatis via auth store bawaan SDK (`authRefresh` saat memulihkan sesi).
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { fileUrl, pb, toApiError } from '@/api/client'

export interface PanelUser {
  id: string
  email: string | null
  full_name: string
  role: string
  /** URL absolut file avatar PocketBase (null bila kosong). */
  avatar_url: string | null
  city: string | null
  points: number
}

/** Role yang boleh memasuki panel admin (PRD §5.1: user|verifier|editor|admin). */
export const PANEL_ROLES = ['admin', 'verifier', 'editor'] as const

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  verifier: 'Verifier',
  editor: 'Editor',
  user: 'Pengguna',
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<PanelUser | null>(null)

  const token = computed(() => (pb.authStore.isValid ? pb.authStore.token : null))
  const isAuthenticated = computed(() => pb.authStore.isValid && user.value !== null)
  const isPanelRole = computed(
    () => user.value !== null && PANEL_ROLES.includes(user.value.role as (typeof PANEL_ROLES)[number]),
  )

  function pickUser(record: Record<string, unknown>): PanelUser {
    return {
      id: String(record.id),
      email: (record.email as string) ?? null,
      full_name: (record.full_name as string) ?? '',
      role: (record.role as string) || 'user',
      avatar_url: fileUrl(record as { id: string }, record.avatar as string),
      city: (record.city as string) || null,
      points: Number(record.points ?? 0),
    }
  }

  function syncFromAuthStore() {
    const record = pb.authStore.record as Record<string, unknown> | null
    user.value = record && record.collectionName === 'users' ? pickUser(record) : null
  }
  pb.authStore.onChange(() => syncFromAuthStore())
  syncFromAuthStore()

  async function login(email: string, password: string) {
    try {
      await pb.collection('users').authWithPassword(email.trim(), password)
      syncFromAuthStore()
    } catch (err) {
      throw toApiError(err)
    }
  }

  /** Pastikan data user terkini (refresh token + record sekaligus). */
  async function fetchMe() {
    if (!pb.authStore.isValid) throw new Error('Tidak ada sesi.')
    try {
      await pb.collection('users').authRefresh()
      syncFromAuthStore()
    } catch (err) {
      throw toApiError(err)
    }
  }

  function logout() {
    pb.authStore.clear()
    user.value = null
  }

  return { token, user, isAuthenticated, isPanelRole, login, fetchMe, logout }
})
