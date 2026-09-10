/**
 * Klien PocketBase untuk panel admin (Sprint 10 — pengganti klien HTTP
 * FastAPI). Satu instance SDK dibagikan seluruh app; auth store bawaan SDK
 * mempersist sesi admin di localStorage.
 *
 * Kontrak lama yang dipertahankan agar perubahan view minimal:
 *   - `ApiError` (status, message) hasil konversi `ClientResponseError` SDK.
 *   - `PB_URL` menggantikan `API_BASE_URL` (URL file kini absolut via
 *     `fileUrl()` — pengganti `${API_BASE_URL}/uploads/…`).
 */
import PocketBase from 'pocketbase'

/** URL dasar backend PocketBase. */
export const PB_URL: string = import.meta.env.VITE_PB_URL ?? 'http://127.0.0.1:8090'

export const pb = new PocketBase(PB_URL)

/** Error aplikasi: status 0 = luring/gangguan jaringan (paritas klien lama). */
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Konversi error apa pun (umumnya ClientResponseError SDK) → ApiError. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  const e = err as { status?: number; response?: { message?: string }; message?: string }
  const status = typeof e?.status === 'number' ? e.status : 0
  if (status === 0) {
    return new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi.')
  }
  const message = e?.response?.message || e?.message || 'Terjadi kesalahan pada server.'
  return new ApiError(status, message)
}

/** URL absolut file record (bukti misi, avatar). */
export function fileUrl(
  record: { id: string },
  filename: string | null | undefined,
): string | null {
  if (!record || !filename) return null
  return pb.files.getURL(record, filename)
}

/** Nama koleksi & id user admin yang sedang masuk. */
export function currentUserId(): string {
  return pb.authStore.record?.id ?? ''
}
