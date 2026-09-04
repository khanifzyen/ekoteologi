/** Unit test util chart admin (Sprint 4) — `utils/chart.ts` (murni). */

import { describe, expect, it } from 'vitest'

import {
  areaPath,
  bars,
  linePath,
  linePoints,
  maxIndex,
  niceMax,
  ticks,
  xPositions,
  type PlotArea,
} from '@/utils/chart'

const area: PlotArea = { left: 40, right: 550, top: 10, bottom: 220 }

describe('niceMax', () => {
  it('melapiskan ke kelipatan 1/2/5 × 10^k', () => {
    expect(niceMax(64)).toBe(100)
    expect(niceMax(190)).toBe(200)
    expect(niceMax(420)).toBe(500)
    expect(niceMax(5)).toBe(5)
    expect(niceMax(0)).toBe(1)
  })
})

describe('ticks', () => {
  it('menghasilkan 5 nilai (0..max) merata', () => {
    expect(ticks(200)).toEqual([0, 50, 100, 150, 200])
  })
})

describe('scale & xPositions', () => {
  it('nilai 0 di bottom, nilai max di top', () => {
    // scaleY diuji lewat linePoints (tidak diekspor langsung di sini).
    const pts = linePoints([0, 200], area)
    expect(pts[0].y).toBe(220)
    expect(pts[1].y).toBe(10)
  })

  it('xPositions merata dari left ke right', () => {
    expect(xPositions(2, area)).toEqual([40, 550])
    expect(xPositions(1, area)).toEqual([40])
    const xs = xPositions(3, area)
    expect(xs[1]).toBeCloseTo((40 + 550) / 2, 5)
  })
})

describe('linePath & areaPath', () => {
  it('polyline diawali M dan menyambung dgn L', () => {
    const pts = linePoints([10, 20, 30], area)
    const d = linePath(pts)
    expect(d.startsWith('M')).toBe(true)
    expect(d.match(/L/g)?.length).toBe(2)
  })

  it('area menutup ke bottom', () => {
    const pts = linePoints([5, 5], area)
    expect(areaPath(pts, area).endsWith(`L${pts[1].x},220 L${pts[0].x},220 Z`)).toBe(true)
  })
})

describe('maxIndex & bars', () => {
  it('maxIndex menunjuk nilai terbesar pertama', () => {
    expect(maxIndex([3, 9, 9, 1])).toBe(1)
    expect(maxIndex([0, 0])).toBe(0)
  })

  it('bars menghasilkan geometri di dalam area & tinggi proporsional', () => {
    const geometry = bars([25, 50, 25], 44, area, 100)
    expect(geometry).toHaveLength(3)
    for (const bar of geometry) {
      expect(bar.x).toBeGreaterThanOrEqual(area.left)
      expect(bar.x + bar.width).toBeLessThanOrEqual(area.right)
      expect(bar.y).toBeGreaterThanOrEqual(area.top)
      expect(bar.height).toBe(area.bottom - bar.y)
    }
    // Batang 50% setengah tinggi batang 100% → 25% = seperempat tinggi penuh.
    expect(geometry[1].height).toBeCloseTo((area.bottom - area.top) / 2, 0)
  })
})
