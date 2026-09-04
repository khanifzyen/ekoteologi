import { describe, expect, it } from 'vitest'

import {
  BODY_MAX,
  broadcastSummary,
  composerError,
  historyLabel,
  TITLE_MAX,
  type BroadcastResult,
} from '../push'

const hasil: BroadcastResult = {
  id: 12,
  title: 'Pengumuman',
  body: 'Isi',
  segment: 'all',
  recipients: 1234,
  tokens: 2000,
  sent: 1980,
}

describe('composerError', () => {
  it('sah bila judul & isi memenuhi ambang', () => {
    expect(composerError('Judul sah', 'Isi pesan yang layak kirim.')).toBe('')
  })

  it('menolak terlalu pendek dan terlalu panjang', () => {
    expect(composerError('Ha', 'Isi pesan yang layak kirim.')).toContain('Judul minimal')
    expect(composerError('Judul', 'pendek')).toContain('Isi pesan minimal')
    expect(composerError('x'.repeat(TITLE_MAX + 1), 'Isi pesan yang layak kirim.')).toContain(
      'Judul maksimal',
    )
    expect(composerError('Judul', 'x'.repeat(BODY_MAX + 1))).toContain('Isi pesan maksimal')
  })
})

describe('broadcastSummary', () => {
  it('memakai format angka id-ID', () => {
    expect(broadcastSummary(hasil)).toBe('Terkirim ke 1.980 dari 2.000 perangkat (1.234 penerima).')
  })
})

describe('historyLabel', () => {
  it('menggabungkan tanggal id-ID dgn label segmen', () => {
    const label = historyLabel('2026-09-04T09:15:00Z', 'Semua pengguna aktif')
    expect(label).toContain('· Semua pengguna aktif')
    expect(label).toMatch(/2026/)
  })
})
