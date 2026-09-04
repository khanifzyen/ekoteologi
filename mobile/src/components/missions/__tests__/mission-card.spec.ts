/** Component test (Sprint 4): MissionCard — 4 keadaan kartu misi + a11y dasar. */

import { describe, expect, it } from 'vitest'

import { mount } from '@vue/test-utils'

import MissionCard from '@/components/missions/MissionCard.vue'
import type { Mission } from '@/types/mission'

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 1,
    title: 'Setor 1 kg Plastik ke Bank Sampah',
    description: 'Unggah foto bukti penyerahan sampahmu.',
    type: 'daily',
    icon: 'fa-recycle',
    points: 50,
    verification: 'photo',
    required_count: 1,
    start_at: null,
    end_at: null,
    my_claim: null,
    ...overrides,
  }
}

const claim = (
  status: 'pending' | 'approved' | 'rejected' | 'in_progress',
  extra = {},
) => ({
  id: 9,
  status,
  progress_count: 0,
  points_awarded: 0,
  review_note: null,
  submitted_at: null,
  ...extra,
})

describe('MissionCard', () => {
  it('misi photo tersedia → tombol Unggah Bukti + catatan consent (PRD §9)', async () => {
    const wrapper = mount(MissionCard, { props: { mission: makeMission() } })
    expect(wrapper.text()).toContain('Setor 1 kg Plastik ke Bank Sampah')
    expect(wrapper.text()).toContain('+50')
    expect(wrapper.text()).toContain('hanya dilihat admin verifier')
    const btn = wrapper.find('button')
    await btn.trigger('click')
    expect(wrapper.emitted('claim-photo')).toHaveLength(1)
  })

  it('misi manual tersedia → tombol Klaim Poin memancarkan claim-unavailable', async () => {
    const wrapper = mount(MissionCard, {
      props: { mission: makeMission({ verification: 'manual' }) },
    })
    expect(wrapper.find('button').text()).toContain('Klaim Poin')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('claim-unavailable')).toHaveLength(1)
  })

  it('klaim pending → status menunggu, tanpa tombol klaim', () => {
    const wrapper = mount(MissionCard, {
      props: { mission: makeMission({ my_claim: claim('pending') }) },
    })
    expect(wrapper.text()).toContain('Menunggu verifikasi admin')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('.mission-card').classes()).toContain('waiting')
  })

  it('klaim approved → kartu done + poin masuk', () => {
    const wrapper = mount(MissionCard, {
      props: {
        mission: makeMission({ my_claim: claim('approved', { points_awarded: 50 }) }),
      },
    })
    expect(wrapper.text()).toContain('Selesai · +50 poin')
    expect(wrapper.find('.mission-card').classes()).toContain('done')
  })

  it('klaim rejected → tombol Unggah Ulang + catatan admin tampil', async () => {
    const wrapper = mount(MissionCard, {
      props: {
        mission: makeMission({ my_claim: claim('rejected', { review_note: 'Foto tidak jelas' }) }),
      },
    })
    expect(wrapper.text()).toContain('Catatan admin: Foto tidak jelas')
    const btn = wrapper.find('button')
    expect(btn.text()).toContain('Unggah Ulang Bukti')
    await btn.trigger('click')
    expect(wrapper.emitted('claim-photo')).toHaveLength(1)
  })

  it('auto_scan → progress bar dengan aria + label otomatis dari scan', () => {
    const wrapper = mount(MissionCard, {
      props: {
        mission: makeMission({
          verification: 'auto_scan',
          required_count: 3,
          my_claim: claim('in_progress', { progress_count: 2 }),
        }),
      },
    })
    expect(wrapper.text()).toContain('2 dari 3 selesai · otomatis dari scan')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('67')
  })
})
