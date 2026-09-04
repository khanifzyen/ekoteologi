/** Unit test helper layar Misi (Sprint 4) — `utils/missions.ts`. */

import { describe, expect, it } from 'vitest'

import type { Mission } from '@/types/mission'
import {
  claimStatusMeta,
  countNewMissions,
  describeClaimError,
  missionIcon,
  missionProgress,
  missionState,
  missionTypeLabel,
  weekPercent,
} from '@/utils/missions'

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 1,
    title: 'Setor Plastik',
    description: 'Unggah bukti',
    type: 'daily',
    icon: null,
    points: 50,
    verification: 'photo',
    required_count: 1,
    start_at: null,
    end_at: null,
    my_claim: null,
    ...overrides,
  }
}

describe('missionState', () => {
  it('misi photo tanpa klaim → available', () => {
    expect(missionState(makeMission())).toBe('available')
  })

  it('misi auto_scan tanpa klaim → progress', () => {
    expect(missionState(makeMission({ verification: 'auto_scan' }))).toBe('progress')
  })

  it('klaim pending → waiting, approved → done, rejected → rejected', () => {
    const claim = (status: 'pending' | 'approved' | 'rejected') => ({
      id: 7,
      status,
      progress_count: 0,
      points_awarded: 0,
      review_note: null,
      submitted_at: null,
    })
    expect(missionState(makeMission({ my_claim: claim('pending') }))).toBe('waiting')
    expect(missionState(makeMission({ my_claim: claim('approved') }))).toBe('done')
    expect(missionState(makeMission({ my_claim: claim('rejected') }))).toBe('rejected')
  })
})

describe('missionIcon & missionTypeLabel', () => {
  it('ikon dari server dipakai bila ada, selain itu default per mode verifikasi', () => {
    expect(missionIcon(makeMission({ icon: 'fa-recycle' }))).toBe('fa-recycle')
    expect(missionIcon(makeMission())).toBe('fa-cloud-arrow-up')
    expect(missionIcon(makeMission({ verification: 'auto_scan' }))).toBe('fa-camera')
    expect(missionIcon(makeMission({ verification: 'manual' }))).toBe('fa-hands-bubbles')
  })

  it('label tipe harian/mingguan/spesial', () => {
    expect(missionTypeLabel('daily')).toBe('Harian')
    expect(missionTypeLabel('weekly')).toBe('Mingguan')
    expect(missionTypeLabel('special')).toBe('Spesial')
  })
})

describe('missionProgress', () => {
  it('progres auto_scan = progress_count / required_count', () => {
    const mission = makeMission({
      verification: 'auto_scan',
      required_count: 3,
      my_claim: {
        id: 1,
        status: 'in_progress',
        progress_count: 2,
        points_awarded: 0,
        review_note: null,
        submitted_at: null,
      },
    })
    expect(missionProgress(mission)).toBe(67)
  })

  it('misi selesai → 100%, misi photo selalu 0%', () => {
    const done = makeMission({
      verification: 'auto_scan',
      my_claim: {
        id: 1,
        status: 'approved',
        progress_count: 3,
        points_awarded: 15,
        review_note: null,
        submitted_at: null,
      },
    })
    expect(missionProgress(done)).toBe(100)
    expect(missionProgress(makeMission())).toBe(0)
  })
})

describe('weekPercent & countNewMissions', () => {
  it('persen mingguan dibatasi 0–100', () => {
    expect(weekPercent(6, 10)).toBe(60)
    expect(weekPercent(0, 0)).toBe(0)
    expect(weekPercent(99, 10)).toBe(100)
  })

  it('misi baru = belum diklaim atau ditolak', () => {
    const missions = [
      makeMission({ id: 1 }),
      makeMission({
        id: 2,
        my_claim: {
          id: 5,
          status: 'rejected',
          progress_count: 0,
          points_awarded: 0,
          review_note: null,
          submitted_at: null,
        },
      }),
      makeMission({
        id: 3,
        my_claim: {
          id: 6,
          status: 'pending',
          progress_count: 0,
          points_awarded: 0,
          review_note: null,
          submitted_at: null,
        },
      }),
    ]
    expect(countNewMissions(missions)).toBe(2)
  })
})

describe('describeClaimError', () => {
  it('409 → sudah diklaim, foto tidak perlu disimpan', () => {
    const content = describeClaimError(409)
    expect(content.title).toBe('Sudah Diklaim')
    expect(content.keepPhoto).toBe(false)
  })

  it('status 0 → luring, foto tetap ada utk kirim ulang', () => {
    const content = describeClaimError(0)
    expect(content.title).toBe('Tidak Ada Koneksi')
    expect(content.keepPhoto).toBe(true)
  })

  it('pesan server dipakai bila tersedia', () => {
    expect(describeClaimError(400, 'Persetujuan penggunaan foto wajib diberikan.').message).toBe(
      'Persetujuan penggunaan foto wajib diberikan.',
    )
  })

  it('500 → gagal umum dgn foto disimpan', () => {
    expect(describeClaimError(500).keepPhoto).toBe(true)
  })
})

describe('claimStatusMeta', () => {
  const claim = (status: 'pending' | 'approved' | 'rejected', points = 0) => ({
    id: 1,
    status,
    progress_count: 0,
    points_awarded: points,
    review_note: null,
    submitted_at: null,
  })

  it('pending → menunggu verifikasi', () => {
    expect(claimStatusMeta(claim('pending')).label).toBe('Menunggu verifikasi admin')
    expect(claimStatusMeta(claim('pending')).tone).toBe('wait')
  })

  it('approved → menampilkan poin', () => {
    expect(claimStatusMeta(claim('approved', 50)).label).toContain('+50 poin')
    expect(claimStatusMeta(claim('approved', 50)).tone).toBe('done')
  })

  it('rejected → perlu diperbaiki', () => {
    expect(claimStatusMeta(claim('rejected')).tone).toBe('rejected')
  })
})
