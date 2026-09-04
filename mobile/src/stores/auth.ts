import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { api, bindTokenProvider } from '@/api/client'

export interface MobileUser {
  id: string
  email: string | null
  full_name: string
  role: string
  avatar_url: string | null
  city: string | null
  points: number
}

interface TokenPair {
  access_token: string
  refresh_token: string
  user: MobileUser
}

export interface ProfileData extends MobileUser {
  level: number
  level_title: string
}

const ACCESS_KEY = 'ekoteologi_access'
const REFRESH_KEY = 'ekoteologi_refresh'

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeKey(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* penyimpanan tidak tersedia — sesi hanya di memori */
  }
}

export const useAuthStore = defineStore('auth', () => {
  const access = ref<string | null>(readKey(ACCESS_KEY))
  const refresh = ref<string | null>(readKey(REFRESH_KEY))
  const user = ref<MobileUser | null>(null)
  const profile = ref<ProfileData | null>(null)
  /** true setelah percobaan pemulihan sesi awal selesai (sukses/gagal). */
  const sessionRestored = ref(false)

  const isAuthenticated = computed(() => access.value !== null)
  const firstName = computed(() => user.value?.full_name.trim().split(/\s+/)[0] ?? '')

  bindTokenProvider({
    getAccessToken: () => access.value,
    getRefreshToken: () => refresh.value,
    onRefreshed: (newAccess, newRefresh) => {
      access.value = newAccess
      refresh.value = newRefresh
      writeKey(ACCESS_KEY, newAccess)
      writeKey(REFRESH_KEY, newRefresh)
    },
    onSessionExpired: () => clearSession(),
  })

  function setSession(tokens: TokenPair) {
    access.value = tokens.access_token
    refresh.value = tokens.refresh_token
    user.value = tokens.user
    writeKey(ACCESS_KEY, tokens.access_token)
    writeKey(REFRESH_KEY, tokens.refresh_token)
  }

  function clearSession() {
    access.value = null
    refresh.value = null
    user.value = null
    profile.value = null
    writeKey(ACCESS_KEY, null)
    writeKey(REFRESH_KEY, null)
  }

  async function login(email: string, password: string, remember = true) {
    const tokens = await api<TokenPair>('/v1/auth/login', {
      method: 'POST',
      body: { email, password, remember },
    })
    setSession(tokens)
    sessionRestored.value = true
  }

  async function register(fullName: string, email: string, password: string) {
    const tokens = await api<TokenPair>('/v1/auth/register', {
      method: 'POST',
      body: { full_name: fullName, email, password },
    })
    setSession(tokens)
    sessionRestored.value = true
  }

  /** Ambil profil (+level) dari server; aman dipanggil berulang. */
  async function ensureProfile() {
    if (!isAuthenticated.value) return
    if (profile.value && user.value) return
    const data = await api<ProfileData>('/v1/profile')
    profile.value = data
    user.value = {
      id: data.id,
      email: data.email,
      full_name: data.full_name,
      role: data.role,
      avatar_url: data.avatar_url,
      city: data.city,
      points: data.points,
    }
  }

  /** Pulihkan sesi dari localStorage saat aplikasi dibuka. */
  async function restoreSession() {
    if (!access.value) {
      sessionRestored.value = true
      return
    }
    try {
      await ensureProfile()
    } catch {
      /* 401 sudah ditangani auto-refresh; jika tetap gagal (offline), biarkan
         token tetap — Home akan menampilkan state error dan bisa retry. */
    } finally {
      sessionRestored.value = true
    }
  }

  async function updateProfile(fields: { full_name?: string; city?: string }) {
    const data = await api<ProfileData>('/v1/profile', { method: 'PATCH', body: fields })
    profile.value = data
    user.value = { ...user.value, ...pickUser(data) }
    return data
  }

  async function uploadAvatar(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    const data = await api<ProfileData>('/v1/profile/avatar', { method: 'POST', formData })
    profile.value = data
    user.value = { ...user.value, ...pickUser(data) }
    return data
  }

  function pickUser(data: ProfileData): MobileUser {
    return {
      id: data.id,
      email: data.email,
      full_name: data.full_name,
      role: data.role,
      avatar_url: data.avatar_url,
      city: data.city,
      points: data.points,
    }
  }

  /** Perbarui total poin dari respons server (mis. `points_total` hasil scan). */
  function applyPoints(pointsTotal: number) {
    if (user.value) user.value = { ...user.value, points: pointsTotal }
    if (profile.value) profile.value = { ...profile.value, points: pointsTotal }
  }

  function logout() {
    clearSession()
    sessionRestored.value = true
  }

  return {
    access,
    refresh,
    user,
    profile,
    sessionRestored,
    isAuthenticated,
    firstName,
    login,
    register,
    logout,
    ensureProfile,
    restoreSession,
    updateProfile,
    uploadAvatar,
    applyPoints,
  }
})
