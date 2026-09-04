import { describe, expect, it } from 'vitest'

import { impactAriaLabel, impactStage } from '../impact'

describe('impactStage — kartu Pohon Kebaikanmu', () => {
  it('aksi 0 → Bibit dengan progres 0', () => {
    const stage = impactStage(0)
    expect(stage.label).toBe('Bibit')
    expect(stage.nextLabel).toBe('Tunas')
    expect(stage.actionsToNext).toBe(5)
    expect(stage.percent).toBe(0)
    expect(stage.isMax).toBe(false)
    expect(stage.hint).toBe('Tumbuh menjadi tunas — butuh 5 aksi lagi.')
  })

  it('aksi 3 → Bibit 60% menuju Tunas', () => {
    const stage = impactStage(3)
    expect(stage.label).toBe('Bibit')
    expect(stage.percent).toBe(60)
    expect(stage.actionsToNext).toBe(2)
  })

  it('aksi 12 → Tunas (30% menuju Pohon Muda)', () => {
    const stage = impactStage(12)
    expect(stage.label).toBe('Tunas')
    expect(stage.percent).toBe(70) // (12-5)/10
    expect(stage.nextLabel).toBe('Pohon Muda')
  })

  it('tepat di ambang tahap naik ke tahap berikutnya dengan progres 0', () => {
    const stage = impactStage(30)
    expect(stage.label).toBe('Pohon Subur')
    expect(stage.percent).toBe(0)
    expect(stage.actionsToNext).toBe(20)
  })

  it('aksi 50+ → Pohon Mangga (puncak, 100%)', () => {
    const stage = impactStage(50)
    expect(stage.label).toBe('Pohon Mangga')
    expect(stage.isMax).toBe(true)
    expect(stage.percent).toBe(100)
    expect(stage.nextLabel).toBeNull()
    expect(stage.hint).toContain('subur rimbun')
  })

  it('di luar rentang & negatif diperlakukan aman', () => {
    expect(impactStage(9999).isMax).toBe(true)
    expect(impactStage(-7).label).toBe('Bibit')
    expect(impactStage(4.9).label).toBe('Bibit') // dibulatkan ke bawah
  })

  it('persen tidak pernah di luar 0–100', () => {
    for (let actions = 0; actions <= 60; actions += 1) {
      const { percent } = impactStage(actions)
      expect(percent).toBeGreaterThanOrEqual(0)
      expect(percent).toBeLessThanOrEqual(100)
    }
  })
})

describe('impactAriaLabel', () => {
  it('memuat tahap kini, persen, dan tahap berikutnya', () => {
    const label = impactAriaLabel(impactStage(3))
    expect(label).toContain('Bibit')
    expect(label).toContain('60%')
    expect(label).toContain('Tunas')
  })

  it('saat puncak menyebut tahap tertinggi', () => {
    expect(impactAriaLabel(impactStage(50))).toContain('tahap tertinggi')
  })
})
