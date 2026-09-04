/** Klien HTTP minimal untuk API FastAPI (tanpa dependensi eksternal). */

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8100'

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  token?: string | null
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`

  let resp: Response
  try {
    resp = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi Anda.')
  }

  const data = (await resp.json().catch(() => null)) as { detail?: string } & Record<
    string,
    unknown
  >
  if (!resp.ok) {
    const detail =
      typeof data?.detail === 'string' ? data.detail : 'Terjadi kesalahan pada server.'
    throw new ApiError(resp.status, detail)
  }
  return data as T
}

export const API_BASE_URL = BASE_URL
