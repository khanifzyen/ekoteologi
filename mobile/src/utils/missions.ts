/** Helper murni layar Misi (Sprint 4) — mudah diuji (vitest). */

import type { Mission, MissionClaim } from '@/types/mission'

/** Keadaan kartu misi (mockup `misi.html` menampilkan 4 wajah kartu). */
export type MissionCardState = 'available' | 'progress' | 'waiting' | 'done' | 'rejected'

/**
 * Petakan misi + klaim saya → keadaan kartu.
 * - `available`: belum diklaim (photo/manual) — aksi klaim.
 * - `progress`: auto_scan yang sedang berjalan (progres dari scan, Sprint 5).
 * - `waiting`: bukti menunggu verifikasi admin.
 * - `done`: disetujui.
 * - `rejected`: ditolak — user bisa unggah ulang bukti.
 */
export function missionState(mission: Mission): MissionCardState {
  const claim = mission.my_claim
  if (claim) {
    if (claim.status === 'approved') return 'done'
    if (claim.status === 'pending') return 'waiting'
    if (claim.status === 'rejected') return 'rejected'
    return 'progress'
  }
  return mission.verification === 'auto_scan' ? 'progress' : 'available'
}

/** Ikon FontAwesome default kartu — ikon dari server dipakai bila ada. */
export function missionIcon(mission: Mission): string {
  if (mission.icon) return mission.icon
  switch (mission.verification) {
    case 'photo':
      return 'fa-cloud-arrow-up'
    case 'auto_scan':
      return 'fa-camera'
    default:
      return 'fa-hands-bubbles'
  }
}

/** Persentase progres misi auto_scan (0–100) — progres penuh baru saat done. */
export function missionProgress(mission: Mission): number {
  if (mission.verification !== 'auto_scan') return 0
  if (mission.my_claim?.status === 'approved') return 100
  return Math.min(100, Math.round((mission.my_claim?.progress_count ?? 0) / mission.required_count * 100))
}

/** Persen ringkasan mingguan (0–100). */
export function weekPercent(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

/** Jumlah misi yang belum selesai pada periode ini (chip "N misi baru"). */
export function countNewMissions(missions: Mission[]): number {
  return missions.filter((m) => m.my_claim === null || m.my_claim.status === 'rejected').length
}

/** Label tipe misi (badge kecil di kartu). */
export function missionTypeLabel(type: Mission['type']): string {
  switch (type) {
    case 'weekly':
      return 'Mingguan'
    case 'special':
      return 'Spesial'
    default:
      return 'Harian'
  }
}

export interface ClaimErrorContent {
  title: string
  message: string
  /** Foto sama layak diunggah ulang tanpa jepret baru (mis. 500 server). */
  keepPhoto: boolean
}

/**
 * Peta status HTTP → konten sheet error klaim (microcopy id, pola `utils/scan.ts`).
 * Status 0 = luring.
 */
export function describeClaimError(status: number, fallback = ''): ClaimErrorContent {
  if (status === 409) {
    return {
      title: 'Sudah Diklaim',
      message: fallback || 'Kamu sudah mengklaim misi ini untuk periode ini.',
      keepPhoto: false,
    }
  }
  if (status === 400) {
    return {
      title: 'Klaim Belum Bisa',
      message:
        fallback ||
        'Persetujuan foto wajib diberikan, atau mode misi ini belum tersedia di versi ini.',
      keepPhoto: true,
    }
  }
  if (status === 413) {
    return {
      title: 'Foto Terlalu Besar',
      message: fallback || 'Ukuran foto melebihi batas. Coba ambil foto lagi.',
      keepPhoto: false,
    }
  }
  if (status === 0) {
    return {
      title: 'Tidak Ada Koneksi',
      message: 'Bukti belum terkirim. Periksa internetmu lalu coba kirim lagi.',
      keepPhoto: true,
    }
  }
  return {
    title: 'Gagal Mengirim',
    message: fallback || 'Terjadi kesalahan saat mengirim bukti. Coba lagi beberapa saat.',
    keepPhoto: true,
  }
}

/** Status klaim → (teks, ikon, kelas warna) utk chip status kartu. */
export function claimStatusMeta(claim: MissionClaim): {
  label: string
  icon: string
  tone: 'wait' | 'done' | 'rejected'
} {
  if (claim.status === 'approved') {
    return { label: `Selesai · +${claim.points_awarded} poin`, icon: 'fa-circle-check', tone: 'done' }
  }
  if (claim.status === 'rejected') {
    return { label: 'Perlu diperbaiki', icon: 'fa-circle-exclamation', tone: 'rejected' }
  }
  return { label: 'Menunggu verifikasi admin', icon: 'fa-hourglass-half', tone: 'wait' }
}
