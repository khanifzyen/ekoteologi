/** Unit test helper layar scan (Sprint 3): latensi, kuota, peta error sheet. */

import { describe, expect, it } from 'vitest'

import {
  describeScanError,
  formatLatency,
  formatRetryAfter,
  quotaLabel,
  recordLatency,
  readLatencies,
} from '@/utils/scan'

describe('formatLatency', () => {
  it('memformat gaya Indonesia dgn koma desimal (dibulatkan 1 desimal)', () => {
    expect(formatLatency(1200)).toBe('1,2 detik')
    expect(formatLatency(1250)).toBe('1,3 detik') // pembulatan ke atas
    expect(formatLatency(2000)).toBe('2,0 detik')
  })

  it('menangani durasi sangat pendek dan nilai tidak valid', () => {
    expect(formatLatency(40)).toBe('< 0,1 detik')
    expect(formatLatency(NaN)).toBe('')
    expect(formatLatency(-5)).toBe('')
  })
})

describe('formatRetryAfter', () => {
  it('menerjemahkan detik ke jam/menit', () => {
    expect(formatRetryAfter(7260)).toContain('2 jam')
    expect(formatRetryAfter(600)).toContain('10 menit')
    expect(formatRetryAfter(30)).toContain('kurang dari 1 menit')
    expect(formatRetryAfter(0)).toBe('')
  })
})

describe('describeScanError', () => {
  it('429 → judul kuota habis + info reset', () => {
    const content = describeScanError(429, 'Kuota scan harian habis.', 7200)
    expect(content.title).toBe('Kuota Scan Habis')
    expect(content.message).toContain('Kuota scan harian habis.')
    expect(content.message).toContain('2 jam')
  })

  it('502 → kartu gagal mengenali dgn tips kualitas foto', () => {
    const content = describeScanError(502, '')
    expect(content.title).toBe('Gagal Mengenali Objek')
    expect(content.tips.length).toBeGreaterThanOrEqual(3)
  })

  it('status 0 → pesan luring', () => {
    expect(describeScanError(0, '').title).toBe('Tidak Ada Koneksi')
  })

  it('413 → foto terlalu besar', () => {
    expect(describeScanError(413, 'Ukuran foto maksimal 5 MB.').title).toBe('Foto Terlalu Besar')
  })
})

describe('quotaLabel', () => {
  it('menyembunyikan pill saat data tidak ada', () => {
    expect(quotaLabel(null)).toBeNull()
  })

  it('menampilkan sisa kuota', () => {
    expect(quotaLabel({ used: 3, limit: 20, remaining: 17, resets_in_seconds: 100 })).toBe(
      'Sisa scan hari ini: 17 dari 20',
    )
  })

  it('menandai kuota habis', () => {
    expect(quotaLabel({ used: 20, limit: 20, remaining: 0, resets_in_seconds: 100 })).toContain(
      'habis',
    )
  })
})

describe('recordLatency / readLatencies', () => {
  it('merekam maksimal 20 pengukuran terakhir', () => {
    localStorage.clear()
    for (let i = 0; i < 25; i++) {
      recordLatency({ ms: i * 10, cached: i % 2 === 0, at: '2026-09-04T00:00:00Z' })
    }
    const list = readLatencies()
    expect(list).toHaveLength(20)
    expect(list[0].ms).toBe(50) // 5 entri awal terbuang
    expect(list[19].ms).toBe(240)
    localStorage.clear()
  })
})
