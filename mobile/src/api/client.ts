/** Klien HTTP mobile untuk API FastAPI — access token + auto-refresh (Sprint 1). */

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8100'

export const API_BASE_URL = BASE_URL

/** URL absolut untuk path relatif dari API (mis. avatar `/uploads/...`). */
export function apiUrl(path: string): string {
  return path.startsWith('http') || path.startsWith('blob:') ? path : `${BASE_URL}${path}`
}

interface TokenProvider {
  getAccessToken: () => string | null
  getRefreshToken: () => string | null
  /** Simpan pasangan token baru hasil rotasi refresh. */
  onRefreshed: (access: string, refresh: string) => void
  /** Refresh ditolak (token kedaluwarsa/akun nonaktif) — sesi diakhiri. */
  onSessionExpired: () => void
}

let tokenProvider: TokenProvider = {
  getAccessToken: () => null,
  getRefreshToken: () => null,
  onRefreshed: () => {},
  onSessionExpired: () => {},
}

/** Dipanggil auth store saat dibuat agar klien tahu ke mana menengok token. */
export function bindTokenProvider(provider: TokenProvider) {
  tokenProvider = provider
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  formData?: FormData
  /** Lampirkan Authorization header (default: true bila ada token). */
  auth?: boolean
  /** Coba refresh token lalu ulang sekali saat 401 (dipakai internal). */
  _retried?: boolean
}

async function parseDetail(resp: Response): Promise<string | null> {
  const data = (await resp.json().catch(() => null)) as { detail?: unknown } | null
  if (typeof data?.detail === 'string') return data.detail
  return null
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const wantsAuth = options.auth !== false
  const token = tokenProvider.getAccessToken()
  if (wantsAuth && token) headers['Authorization'] = `Bearer ${token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  let resp: Response
  try {
    resp = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    })
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi Anda.')
  }

  if (resp.status === 401 && wantsAuth && token && !options._retried) {
    const refreshed = await tryRefresh()
    if (refreshed) return request<T>(path, { ...options, _retried: true })
  }

  if (!resp.ok) {
    const detail = (await parseDetail(resp)) ?? 'Terjadi kesalahan pada server.'
    throw new ApiError(resp.status, detail)
  }
  return (await resp.json()) as T
}

let refreshInFlight: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  const refresh = tokenProvider.getRefreshToken()
  if (!refresh) return false
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const resp = await fetch(`${BASE_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!resp.ok) {
        tokenProvider.onSessionExpired()
        return false
      }
      const data = (await resp.json()) as { access_token: string; refresh_token: string }
      tokenProvider.onRefreshed(data.access_token, data.refresh_token)
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

export function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  return request<T>(path, options)
}
