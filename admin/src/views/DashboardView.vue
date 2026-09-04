<script setup lang="ts">
/**
 * Dashboard admin (Sprint 3) — KPI cards read-only sesuai mockup
 * `admin/index.html`; sumber data `GET /v1/admin/kpi`. Grafik scan harian,
 * komposisi kategori, dan biaya LLM menyusul Sprint 4 (implementation-plan).
 */
import { computed, onMounted, ref } from 'vue'

import { ApiError, api } from '@/api/client'
import KpiCard from '@/components/KpiCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import { useAuthStore } from '@/stores/auth'

interface DashboardKpi {
  users: { total: number; new_7d: number }
  scans: { today: number; total: number }
  verification: { pending: number }
  cache: { hit: number; miss: number; hit_rate: number | null }
}

const auth = useAuthStore()

const kpi = ref<DashboardKpi | null>(null)
const loading = ref(true)
const error = ref('')

const today = computed(() =>
  new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date()),
)

const cacheTotal = computed(() => (kpi.value ? kpi.value.cache.hit + kpi.value.cache.miss : 0))

function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    kpi.value = await api<DashboardKpi>('/v1/admin/kpi', { token: auth.token })
  } catch (err) {
    error.value =
      err instanceof ApiError
        ? err.status === 0
          ? 'Tidak dapat terhubung ke server. Periksa koneksi.'
          : err.message
        : 'Terjadi kesalahan pada server.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Dashboard</h1>
      <p>{{ today }} · ringkasan data (read-only)</p>
    </div>
    <BaseButton
      variant="outline"
      @click="load"
    >
      <i
        class="fas fa-rotate-right"
        aria-hidden="true"
      />
      Segarkan
    </BaseButton>
  </div>

  <!-- Loading -->
  <div
    v-if="loading"
    class="kpi-grid"
    aria-label="Memuat KPI"
  >
    <div
      v-for="n in 4"
      :key="n"
      class="panel"
    >
      <div class="panel-body">
        <BaseSkeleton />
        <div class="sk-gap" />
        <BaseSkeleton />
      </div>
    </div>
  </div>

  <!-- Error -->
  <div
    v-else-if="error"
    class="panel"
  >
    <div
      class="panel-body dash-error"
      role="alert"
    >
      <i
        class="fas fa-triangle-exclamation"
        aria-hidden="true"
      />
      <p>{{ error }}</p>
      <BaseButton
        variant="outline"
        @click="load"
      >
        <i
          class="fas fa-rotate-right"
          aria-hidden="true"
        />
        Coba Lagi
      </BaseButton>
    </div>
  </div>

  <!-- KPI cards (read-only) -->
  <template v-else-if="kpi">
    <div class="kpi-grid">
      <KpiCard
        icon="fa-users"
        label="Pengguna Terdaftar"
        :value="formatNumber(kpi.users.total)"
        :delta="`+${formatNumber(kpi.users.new_7d)} dalam 7 hari`"
        tone="up"
      />
      <KpiCard
        icon="fa-camera"
        label="Total Scan Hari Ini"
        :value="formatNumber(kpi.scans.today)"
        :delta="`total ${formatNumber(kpi.scans.total)} scan`"
        tone="up"
      />
      <KpiCard
        icon="fa-clipboard-check"
        label="Antrian Verifikasi"
        :value="formatNumber(kpi.verification.pending)"
        delta="bukti misi menunggu review (Sprint 4)"
        tone="down"
      />
      <KpiCard
        icon="fa-database"
        label="Cache LLM Hit Rate"
        :value="kpi.cache.hit_rate === null ? '—' : `${kpi.cache.hit_rate}%`"
        :delta="`${formatNumber(kpi.cache.hit)} hit / ${formatNumber(cacheTotal)} analisis`"
        tone="neutral"
      />
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Menyusul Sprint 4</h2>
          <div class="sub">
            Grafik scan harian &amp; komposisi kategori + biaya LLM per implementation-plan
          </div>
        </div>
      </div>
      <div class="panel-body">
        <p class="dash-note">
          Mode LLM saat ini: <strong>mock</strong> (biaya Rp0 — provider asli menyusul staging,
          keputusan §2.1 #2). Kartu "Biaya LLM" akan aktif bersama metrik biaya di Sprint 4.
        </p>
      </div>
    </div>
  </template>
</template>

<style scoped>
.sk-gap {
  height: var(--space-2);
}
.dash-error {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-danger-strong);
  flex-wrap: wrap;
}
.dash-note {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.dash-note strong {
  color: var(--color-heading);
}
</style>
