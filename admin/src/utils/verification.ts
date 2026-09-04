/** Helper murni layar Verifikasi (Sprint 5) — mudah diuji (vitest). */

export type ReviewDecision = 'approved' | 'rejected'

/** Label tipe misi (detail panel, konsisten dgn modul Misi). */
export function missionTypeLabel(type: string): string {
  switch (type) {
    case 'weekly':
      return 'Mingguan'
    case 'special':
      return 'Spesial'
    default:
      return 'Harian'
  }
}

/** Label mode verifikasi. */
export function verificationLabel(verification: string): string {
  switch (verification) {
    case 'auto_scan':
      return 'otomatis dari scan'
    case 'manual':
      return 'manual'
    default:
      return 'verifikasi foto'
  }
}

/** Sub-judul panel: "Misi mingguan · verifikasi foto · +50 poin" (mockup). */
export function claimSubtitle(mission: {
  type: string
  verification: string
  points: number
}): string {
  return `${missionTypeLabel(mission.type)} · ${verificationLabel(mission.verification)} · +${mission.points} poin`
}

/** Validasi keputusan review — catatan wajib saat menolak (AUDIT.md A2). */
export function reviewError(decision: ReviewDecision, note: string): string {
  if (decision === 'rejected' && note.trim().length === 0) {
    return 'Tuliskan catatan alasan penolakan dulu, ya.'
  }
  return ''
}

/** Sejarah klaim: "Misi ke-N pengguna ini" (N = total klaim pengguna, termasuk ini). */
export function historyLabel(userClaimsTotal: number): string {
  if (userClaimsTotal <= 1) return 'Klaim pertama pengguna ini'
  return `Misi ke-${userClaimsTotal} pengguna ini`
}

/** Waktu unggah ringkas: "Hari ini, 09.12" / "Kemarin, 21.40" / "3 Sep, 14.05". */
export function formatUploaded(value: string | null, now = new Date()): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const time = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((dayStart.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000)
  if (diffDays === 0) return `Hari ini, ${time}`
  if (diffDays === 1) return `Kemarin, ${time}`
  return `${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(date)}, ${time}`
}

/** Indeks aktif berikutnya setelah satu item direview & dihapus dari antrian. */
export function nextIndexAfterRemove(index: number, lengthAfterRemove: number): number {
  if (lengthAfterRemove === 0) return 0
  return Math.min(index, lengthAfterRemove - 1)
}
