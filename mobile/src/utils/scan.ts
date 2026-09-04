/**
 * Helper murni layar Scan (Sprint 3) — sengaja tanpa dependensi Vue agar
 * mudah diuji unit (vitest): format latensi, petakan error API ke konten
 * sheet error, dan label kuota harian.
 */

import type { ScanQuota } from '@/types/scan'

export interface ErrorSheetContent {
  title: string
  message: string
  tips: string[]
}

/** Tips umum kualitas foto (mockup scan.html — kartu error). */
const FOTO_TIPS = [
  'Objek berada penuh di dalam bingkai',
  'Pencahayaan cukup terang',
  'Kamera stabil, tidak blur',
]

/**
 * Format durasi analisis dgn gaya Indonesia (koma desimal).
 * 850 → "0,9 detik"; 1250 → "1,2 detik"; <100 → "< 0,1 detik".
 */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 100) return '< 0,1 detik'
  const seconds = ms / 1000
  return `${seconds.toFixed(1).replace('.', ',')} detik`
}

/** Ubah `Retry-After` (detik) jadi teks jam:menit yang ramah. */
export function formatRetryAfter(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.ceil((seconds % 3600) / 60)
  if (hours > 0) return `sekitar ${hours} jam ${minutes} menit lagi`
  if (minutes <= 1) return 'kurang dari 1 menit lagi'
  return `sekitar ${minutes} menit lagi`
}

/** Petakan error `POST /v1/scan` ke konten sheet error (copy Bahasa Indonesia). */
export function describeScanError(status: number, detail: string, retryAfter = 0): ErrorSheetContent {
  if (status === 429) {
    const kapan = retryAfter > 0 ? ` Kuota direset ${formatRetryAfter(retryAfter)}.` : ''
    return {
      title: 'Kuota Scan Habis',
      message: `${detail}${kapan}`,
      tips: ['Satu kuota terpakai per foto yang diunggah', 'Foto duplikat tidak menghabiskan poin, tetapi tetap menghabiskan kuota'],
    }
  }
  if (status === 502) {
    return {
      title: 'Gagal Mengenali Objek',
      message: 'Layanan analisis sedang gangguan atau foto sulit dikenali.',
      tips: FOTO_TIPS,
    }
  }
  if (status === 413) {
    return {
      title: 'Foto Terlalu Besar',
      message: detail || 'Ukuran foto melebihi batas unggah.',
      tips: ['Ambil foto dari dalam aplikasi, bukan galeri beresolusi tinggi'],
    }
  }
  if (status === 400) {
    return {
      title: 'Foto Tidak Dapat Diproses',
      message: detail || 'Format foto tidak didukung.',
      tips: ['Gunakan format JPG atau PNG'],
    }
  }
  if (status === 0) {
    return {
      title: 'Tidak Ada Koneksi',
      message: 'Analisis butuh internet. Periksa koneksi lalu coba lagi.',
      tips: ['Aktifkan data seluler atau Wi-Fi'],
    }
  }
  return {
    title: 'Terjadi Kesalahan',
    message: detail || 'Coba lagi beberapa saat.',
    tips: FOTO_TIPS,
  }
}

/** Teks pill kuota di layar scan; null → pill disembunyikan. */
export function quotaLabel(quota: ScanQuota | null): string | null {
  if (!quota) return null
  if (quota.remaining <= 0) return 'Kuota scan hari ini habis'
  return `Sisa scan hari ini: ${quota.remaining} dari ${quota.limit}`
}

export interface ScanPerfEntry {
  ms: number
  cached: boolean
  at: string
}

const PERF_KEY = 'ekoteologi_scan_perf'
const PERF_MAX = 20

/** Simpan satu pengukuran latensi (uji lapangan Sprint 3) — best effort. */
export function recordLatency(entry: ScanPerfEntry): void {
  try {
    const raw = localStorage.getItem(PERF_KEY)
    const list: ScanPerfEntry[] = raw ? JSON.parse(raw) : []
    list.push(entry)
    localStorage.setItem(PERF_KEY, JSON.stringify(list.slice(-PERF_MAX)))
  } catch {
    /* penyimpanan tidak tersedia — pengukuran hanya di memori sesi */
  }
}

/** Ambil seluruh pengukuran latensi tercatat (untuk laporan/uji lapangan). */
export function readLatencies(): ScanPerfEntry[] {
  try {
    const raw = localStorage.getItem(PERF_KEY)
    return raw ? (JSON.parse(raw) as ScanPerfEntry[]) : []
  } catch {
    return []
  }
}
