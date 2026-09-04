import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { api, bindTokenProvider } from '@/api/client'

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
  refresh_token: string
  token_type: string
  user: PanelUser
}

const TOKEN_KEY = 'ekoteologi_admin_token'
const REFRESH_KEY = 'ekoteologi_admin_refresh'

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
  const refresh = ref<string | null>(localStorage.getItem(REFRESH_KEY))
  const user = ref<PanelUser | null>(null)

  const isAuthenticated = computed(() => token.value !== null)
  const isPanelRole = computed(() => user.value !== null && PANEL_ROLES.includes(user.value.role as (typeof PANEL_ROLES)[number]))

  bindTokenProvider({
    getAccessToken: () => token.value,
    getRefreshToken: () => refresh.value,
    onRefreshed: (access, refreshToken) => {
      token.value = access
      refresh.value = refreshToken
      localStorage.setItem(TOKEN_KEY, access)
      localStorage.setItem(REFRESH_KEY, refreshToken)
    },
    onSessionExpired: () => logout(),
  })

  function setSession(newToken: string, newRefresh: string, newUser: PanelUser) {
    token.value = newToken
    refresh.value = newRefresh
    user.value = newUser
    localStorage.setItem(TOKEN_KEY, newToken)
    localStorage.setItem(REFRESH_KEY, newRefresh)
  }

  async function login(email: string, password: string) {
    const resp = await api<LoginResponse>('/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    setSession(resp.access_token, resp.refresh_token, resp.user)
  }

  async function fetchMe() {
    const me = await api<PanelUser>('/v1/auth/me', { token: token.value })
    user.value = me
  }

  function logout() {
    token.value = null
    refresh.value = null
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  }

  return { token, refresh, user, isAuthenticated, isPanelRole, login, fetchMe, logout }
})
