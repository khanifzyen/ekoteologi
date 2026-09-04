<script setup lang="ts">
import { computed } from 'vue'

import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseChip from '@/components/ui/BaseChip.vue'
import { ROLE_LABEL, useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const auth = useAuthStore()
const toast = useToastStore()

const today = computed(() =>
  new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date()),
)

const initials = computed(() =>
  (auth.user?.full_name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join(''),
)
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Dashboard</h1>
      <p>{{ today }} · KPI &amp; grafik tampil mulai Sprint 3–4</p>
    </div>
    <BaseButton
      variant="outline"
      @click="toast.show('Export CSV tampil bersama modul laporan (Sprint 8).')"
    >
      <i
        class="fas fa-download"
        aria-hidden="true"
      />
      Export
    </BaseButton>
  </div>

  <BaseCard
    title="Sprint 0 — Fondasi Teknis"
    sub="Shell admin tampil sesuai mockup D3"
  >
    <div class="empty">
      <div class="empty-icon">
        <i
          class="fas fa-chart-line"
          aria-hidden="true"
        />
      </div>
      <h3>Belum ada data dashboard</h3>
      <p>
        Kartu KPI (pengguna aktif, scan harian, antrian verifikasi, biaya LLM) dan grafik
        mengikuti data fitur yang dibangun di Sprint 3–4. API sudah berjalan — cek
        <code>GET /health</code>.
      </p>
    </div>
  </BaseCard>

  <BaseCard
    title="Akun Aktif"
    sub="Sesi login Anda"
  >
    <div class="account-row">
      <div
        class="avatar-initials"
        aria-hidden="true"
      >
        {{ initials }}
      </div>
      <div class="who">
        <strong>{{ auth.user?.full_name }}</strong>
        <span>{{ auth.user?.email }}</span>
      </div>
      <BaseChip :variant="auth.user?.role === 'admin' ? 'admin' : 'verifier'">
        {{ ROLE_LABEL[auth.user?.role ?? ''] ?? auth.user?.role }}
      </BaseChip>
    </div>
  </BaseCard>
</template>
