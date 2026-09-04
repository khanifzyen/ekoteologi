import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { api } from '@/api/client'

export interface PanelUser {
  id: string
  email: string | null
  full_name: string
  role: string
  avatar_url: string | null
  city: string | null
  points: number
}

interface LoginResponse {
  access_token: string
  token_type: string
  user: PanelUser
}

const TOKEN_KEY = 'ekoteologi_admin_token'

/** Role yang boleh memasuki panel admin (PRD §5.1: user|verifier|editor|admin). */
export const PANEL_ROLES = ['admin', 'verifier', 'editor'] as const

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  verifier: 'Verifier',
  editor: 'Editor',
  user: 'Pengguna',
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const user = ref<PanelUser | null>(null)

  const isAuthenticated = computed(() => token.value !== null)
  const isPanelRole = computed(() => user.value !== null && PANEL_ROLES.includes(user.value.role as (typeof PANEL_ROLES)[number]))

  function setSession(newToken: string, newUser: PanelUser) {
    token.value = newToken
    user.value = newUser
    localStorage.setItem(TOKEN_KEY, newToken)
  }

  async function login(email: string, password: string) {
    const resp = await api<LoginResponse>('/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    setSession(resp.access_token, resp.user)
  }

  async function fetchMe() {
    const me = await api<PanelUser>('/v1/auth/me', { token: token.value })
    user.value = me
  }

  function logout() {
    token.value = null
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
  }

  return { token, user, isAuthenticated, isPanelRole, login, fetchMe, logout }
})
