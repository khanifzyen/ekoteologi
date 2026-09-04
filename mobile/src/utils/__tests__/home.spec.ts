import { describe, expect, it } from 'vitest'

import type { DailyContent } from '@/types/daily'
import type { Mission } from '@/types/mission'
import { contentTypeLabel, wisdomShareText } from '../daily'
import { pickMiniMissions } from '../home'

function content(overrides: Partial<DailyContent> = {}): DailyContent {
  return {
    date: '2026-09-04',
    type: 'ayat',
    title: null,
    body: 'Sesungguhnya Allah itu indah.',
    source: 'HR. Muslim',
    eco_action: 'setor 1 botol ke bank sampah',
    fallback: false,
    ...overrides,
  }
}

describe('contentTypeLabel', () => {
  it('memetakan semua tipe konten', () => {
    expect(contentTypeLabel('ayat')).toBe('Ayat')
    expect(contentTypeLabel('hadis')).toBe('Hadis')
    expect(contentTypeLabel('refleksi')).toBe('Refleksi')
    expect(contentTypeLabel('fallback')).toBe('Kutipan')
  })

  it('tipe asing/kosong → "Kutipan"', () => {
    expect(contentTypeLabel('puisi')).toBe('Kutipan')
    expect(contentTypeLabel(null)).toBe('Kutipan')
  })
})

describe('wisdomShareText', () => {
  it('memuat kutipan, sumber, dan tanda aplikasi', () => {
    const text = wisdomShareText(content())
    expect(text).toContain('"Sesungguhnya Allah itu indah."')
    expect(text).toContain('— HR. Muslim')
    expect(text).toContain('Ekoteologi AR')
  })

  it('tanpa sumber tidak menulis garis sumber', () => {
    const text = wisdomShareText(content({ source: null }))
    expect(text).not.toContain('—')
  })
})

function mission(overrides: Partial<Mission>): Mission {
  return {
    id: 1,
    title: 'Misi uji',
    description: null,
    type: 'daily',
    icon: 'fa-bullseye',
    points: 10,
    verification: 'manual',
    required_count: 1,
    start_at: null,
    end_at: null,
    my_claim: null,
    ...overrides,
  }
}

describe('pickMiniMissions — kartu "Misi Hari Ini" beranda', () => {
  it('menampilkan auto_scan berjalan lebih dulu, diurutkan persen terbesar', () => {
    const items = [
      mission({ id: 1, title: 'Scan A', verification: 'auto_scan', required_count: 3, my_claim: { id: 1, status: 'in_progress', progress_count: 1, points_awarded: 0, review_note: null, submitted_at: null } }),
      mission({ id: 2, title: 'Scan B', verification: 'auto_scan', required_count: 2, points: 15, my_claim: { id: 2, status: 'in_progress', progress_count: 1, points_awarded: 0, review_note: null, submitted_at: null } }),
      mission({ id: 3, title: 'Manual', verification: 'manual' }),
    ]
    const minis = pickMiniMissions(items, 3)
    expect(minis[0].mission.id).toBe(2) // 50% — paling dekat selesai
    expect(minis[0].percent).toBe(50)
    expect(minis[0].progressLabel).toBe('1/2')
    expect(minis[1].mission.id).toBe(1) // 33%
    expect(minis[2].mission.id).toBe(3)
  })

  it('misi pending/approved/auto_scan tanpa progres tidak dipajang', () => {
    const items = [
      mission({ id: 1, verification: 'photo', my_claim: { id: 1, status: 'pending', progress_count: 0, points_awarded: 0, review_note: null, submitted_at: null } }),
      mission({ id: 2, verification: 'auto_scan', my_claim: { id: 2, status: 'approved', progress_count: 3, points_awarded: 15, review_note: null, submitted_at: null } }),
      mission({ id: 3, verification: 'manual', points: 5 }),
    ]
    const minis = pickMiniMissions(items)
    expect(minis).toHaveLength(1)
    expect(minis[0].mission.id).toBe(3)
    expect(minis[0].progressLabel).toBe('+5')
  })

  it('misi klaim bisa dipilih diurutkan poin terbesar + dibatasi max', () => {
    const items = [
      mission({ id: 1, points: 10 }),
      mission({ id: 2, points: 50 }),
      mission({ id: 3, points: 20 }),
    ]
    const minis = pickMiniMissions(items, 2)
    expect(minis.map((m) => m.mission.id)).toEqual([2, 3])
  })

  it('tanpa misi → kosong (kartu disembunyikan)', () => {
    expect(pickMiniMissions([])).toEqual([])
  })
})
