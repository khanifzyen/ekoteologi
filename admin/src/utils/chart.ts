/**
 * Util murni chart (Sprint 4) — skala & geometri SVG gaya editorial
 * (axis hairline, 4 tick, anotasi titik kunci) sesuai mockup `admin/index.html`.
 * Dipisah dari komponen agar bisa diuji vitest.
 */

export interface Point {
  x: number
  y: number
}

export interface PlotArea {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Langit-langit "cantik" untuk sumbu Y: dilapiskan ke kelipatan 1/2/5 × 10^k
 * (mis. max 64 → 100, max 190 → 200, max 420 → 500).
 */
export function niceMax(value: number): number {
  if (value <= 0) return 1
  const exp = Math.floor(Math.log10(value))
  const base = 10 ** exp
  for (const m of [1, 2, 5, 10]) {
    if (value <= m * base) return m * base
  }
  return 10 * base
}

/** Nilai sumbu Y mulai 0 sampai max sebanyak `count` tick (inklusif). */
export function ticks(max: number, count = 4): number[] {
  const step = max / count
  return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i))
}

/** Posisi y nilai pada area plot (0 di bottom, max di top). */
export function scaleY(value: number, max: number, area: PlotArea): number {
  const ratio = Math.min(Math.max(value, 0), max) / max
  return area.bottom - ratio * (area.bottom - area.top)
}

/** Posisi x merata untuk `count` titik dari left ke right (inklusif). */
export function xPositions(count: number, area: PlotArea): number[] {
  if (count <= 1) return [area.left]
  const step = (area.right - area.left) / (count - 1)
  return Array.from({ length: count }, (_, i) => area.left + step * i)
}

/** Rangkaian titik garis chart dari nilai + label tanggal. */
export function linePoints(values: number[], area: PlotArea): Point[] {
  const max = niceMax(Math.max(...values, 0))
  const xs = xPositions(values.length, area)
  return values.map((v, i) => ({ x: xs[i] ?? area.left, y: scaleY(v, max, area) }))
}

/** Atribut `d` untuk polyline (garis utama). */
export function linePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)},${round(p.y)}`).join(' ')
}

/** Atribut `d` untuk area di bawah garis (fill tipis). */
export function areaPath(points: Point[], area: PlotArea): string {
  if (points.length === 0) return ''
  const first = points[0]
  const last = points[points.length - 1]
  return `${linePath(points)} L${round(last.x)},${round(area.bottom)} L${round(first.x)},${round(
    area.bottom,
  )} Z`
}

/** Indeks nilai maksimum (anotasi titik kunci gaya editorial). */
export function maxIndex(values: number[]): number {
  let idx = 0
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[idx]) idx = i
  }
  return idx
}

export interface Bar {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Geometri batang vertikal: `count` batang dibagi rata dalam area plot
 * dengan lebar `barWidth` — label persen ditulis di atas batang.
 */
export function bars(values: number[], barWidth: number, area: PlotArea, max: number): Bar[] {
  const count = values.length
  const slot = count > 0 ? (area.right - area.left) / count : 0
  return values.map((v, i) => {
    const y = scaleY(v, max, area)
    const x = area.left + slot * i + (slot - barWidth) / 2
    return { x: round(x), y: round(y), width: barWidth, height: round(area.bottom - y) }
  })
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
