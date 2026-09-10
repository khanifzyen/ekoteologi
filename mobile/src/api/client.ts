/**
 * Klien PocketBase mobile (Sprint 10 — pengganti klien HTTP FastAPI).
 *
 * Satu instance SDK `pocketbase` dibagikan seluruh aplikasi: auth store bawaan
 * SDK mempersist token di localStorage (penyimpanan WebView Capacitor) dan
 * mengelola token otomatis. Lapisan ini juga menyediakan:
 *   - `ApiError` — bentuk error yang sama dgn versi FastAPI (views tetap),
 *     hasil konversi `ClientResponseError` SDK.
 *   - `fileUrl()` — URL absolut file koleksi (pengganti `apiUrl('/uploads/…')`).
 * Alur bisnis scan/klaim/kuis yang butuh hook menyusul di Sprint 11–13 —
 * sementara lewat API koleksi bawaan dgn rules yang ada (implementation-plan §5).
 */
import PocketBase from 'pocketbase'

/** URL dasar backend PocketBase. */
export const PB_URL: string = import.meta.env.VITE_PB_URL ?? 'http://127.0.0.1:8090'

export const pb = new PocketBase(PB_URL)

/** Error aplikasi: status 0 = luring/gangguan jaringan (paritas klien lama). */
export class ApiError extends Error {
  status: number
  /** Detik `Retry-After` bila server mengirimnya (429 kuota scan — Sprint 11). */
  retryAfterSeconds: number | null

  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** Konversi error apa pun (umumnya ClientResponseError SDK) → ApiError. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  const e = err as { status?: number; response?: { message?: string }; message?: string; isAbort?: boolean }
  const status = typeof e?.status === 'number' ? e.status : 0
  if (status === 0) {
    return new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi Anda.')
  }
  const message = e?.response?.message || e?.message || 'Terjadi kesalahan pada server.'
  return new ApiError(status, message)
}

/**
 * URL absolut untuk path/file dari backend. Kini file PocketBase sudah
 * di-return absolut oleh `fileUrl()`, jadi fungsi ini hanya menjaga
 * kompatibilitas view lama (URL absolut diteruskan apa adanya).
 */
export function apiUrl(path: string): string {
  return path.startsWith('http') || path.startsWith('blob:') || path.startsWith('data:')
    ? path
    : `${PB_URL}${path}`
}

/** URL absolut file record (avatar, bukti misi, foto scan). */
export function fileUrl(
  record: { id: string; collectionId?: string; collectionName?: string },
  filename: string | null | undefined,
): string | null {
  if (!record || !filename) return null
  return pb.files.getURL(record, filename)
}

/** Nama koleksi & id user yang sedang masuk ("" bila anonim). */
export function currentUserId(): string {
  return pb.authStore.record?.id ?? ''
}
