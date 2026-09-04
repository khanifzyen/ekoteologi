/** Component test (Sprint 3): ConsentCard (PRD §9) + datetime helpers. */

import { describe, expect, it } from 'vitest'

import { mount } from '@vue/test-utils'

import ConsentCard from '@/components/scan/ConsentCard.vue'
import { formatTime, relativeDay } from '@/utils/datetime'

describe('ConsentCard', () => {
  it('menampilkan judul, deskripsi, dan poin privasi', () => {
    const wrapper = mount(ConsentCard)
    expect(wrapper.text()).toContain('Izin Penggunaan Foto')
    expect(wrapper.text()).toContain('dianalisis AI')
    expect(wrapper.text()).toContain('tidak dibagikan')
  })

  it('memancarkan event agree saat tombol setuju diklik', async () => {
    const wrapper = mount(ConsentCard)
    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('agree')).toHaveLength(1)
  })

  it('memancarkan event cancel saat tombol batal diklik', async () => {
    const wrapper = mount(ConsentCard)
    const buttons = wrapper.findAll('button')
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})

describe('datetime helpers', () => {
  it('relativeDay mengenali hari ini dan kemarin', () => {
    const now = new Date()
    expect(relativeDay(now)).toBe('Hari ini')
    const yesterday = new Date(now.getTime() - 86_400_000)
    expect(relativeDay(yesterday)).toBe('Kemarin')
  })

  it('formatTime menghasilkan pola jam:menit', () => {
    expect(formatTime('2026-09-04T09:05:00Z')).toMatch(/^\d{2}[.:]\d{2}$/)
  })
})
