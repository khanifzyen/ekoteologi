/** Unit test consent foto (PRD §9) — simpan/baca status persetujuan. */

import { beforeEach, describe, expect, it } from 'vitest'

import { grantFotoConsent, hasFotoConsent } from '@/utils/consent'

describe('consent foto', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('default belum consent', () => {
    expect(hasFotoConsent()).toBe(false)
  })

  it('grantFotoConsent menyimpan status + waktu', () => {
    grantFotoConsent()
    expect(hasFotoConsent()).toBe(true)
    const raw = JSON.parse(localStorage.getItem('ekoteologi_consent_foto') ?? 'null') as {
      granted: number
      at: string
    } | null
    expect(raw?.granted).toBe(1)
    expect(typeof raw?.at).toBe('string')
  })
})
