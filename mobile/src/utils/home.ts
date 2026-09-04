/**
 * Util beranda (Sprint 6) — pemilihan misi mini "Misi Hari Ini" `beranda.html`
 * (fungsi murni, teruji).
 */

import type { Mission } from '@/types/mission'

export interface MiniMission {
  mission: Mission
  /** Persen progres (0–100) — auto_scan progres; lainnya 0/100 sesuai status. */
  percent: number
  /** Teks kanan ("2/3" / "+15"). */
  progressLabel: string
}

function percentOf(mission: Mission): number {
  if (mission.my_claim?.status === 'approved') return 100
  if (mission.verification === 'auto_scan') {
    const target = Math.max(1, mission.required_count)
    return Math.min(100, Math.round((mission.my_claim?.progress_count ?? 0) / target * 100))
  }
  return 0
}

/**
 * Pilih maksimal `max` misi utk kartu mini beranda:
 * 1) auto_scan yang sedang berjalan (paling dekat selesai dulu),
 * 2) misi yang bisa diklaim (photo/manual) — urut poin terbesar.
 * Misi pending/approved/rejected tidak dipajang (sudah "selesai" di beranda).
 */
export function pickMiniMissions(missions: Mission[], max = 2): MiniMission[] {
  const running: MiniMission[] = []
  const available: MiniMission[] = []
  for (const mission of missions) {
    const status = mission.my_claim?.status
    if (mission.verification === 'auto_scan') {
      if (status === 'in_progress') {
        running.push({
          mission,
          percent: percentOf(mission),
          progressLabel: `${mission.my_claim?.progress_count ?? 0}/${mission.required_count}`,
        })
      }
      continue // auto_scan tanpa progres / approved tidak menarik di beranda
    }
    if (mission.my_claim === null) {
      available.push({ mission, percent: 0, progressLabel: `+${mission.points}` })
    }
  }
  running.sort((a, b) => b.percent - a.percent)
  available.sort((a, b) => b.mission.points - a.mission.points)
  return [...running, ...available].slice(0, max)
}
