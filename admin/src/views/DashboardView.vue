<script setup lang="ts">
/**
 * Dashboard admin (Sprint 3–4) — mockup `admin/index.html` lengkap:
 * 4 KPI cards (pengguna, scan hari ini, antrian verifikasi, Biaya LLM)
 * + 2 chart gaya editorial (scan harian & komposisi kategori).
 * Sumber: `GET /v1/admin/kpi` + `GET /v1/admin/charts` (read-only).
 */
import { computed, onMounted, ref } from 'vue'

import { ApiError, api } from '@/api/client'
import ChartBar from '@/components/ChartBar.vue'
import ChartLine from '@/components/ChartLine.vue'
import KpiCard from '@/components/KpiCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import { useAuthStore } from '@/stores/auth'

interface DashboardKpi {
  users: { total: number; new_7d: number }
  scans: { today: number; total: number }
  verification: { pending: number }
  cache: { hit: number; miss: number; hit_rate: number | null }
  llm: { cost_month: number; tokens_month: number; budget_monthly: number | null }
}

interface ChartsData {
  days: number
  daily: { date: string; count: number }[]
  categories: { name: string; count: number; percentage: number }[]
  categories_total: number
}

const auth = useAuthStore()

const kpi = ref<DashboardKpi | null>(null)
const charts = ref<ChartsData | null>(null)
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

const dailyLabels = computed(() =>
  (charts.value?.daily ?? []).map((d) =>
    new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
  ),
)
const dailyValues = computed(() => (charts.value?.daily ?? []).map((d) => d.count))
const dailyTotal = computed(() => dailyValues.value.reduce((a, b) => a + b, 0))
const catLabels = computed(() => (charts.value?.categories ?? []).map((c) => c.name))
const catValues = computed(() => (charts.value?.categories ?? []).map((c) => c.percentage))
const cacheFoot = computed(() => {
  const rate = kpi.value?.cache.hit_rate
  const detail =
    kpi.value && cacheTotal.value > 0 ? ` (${kpi.value.cache.hit}/${cacheTotal.value} analisis)` : ''
  return `Sumber: tabel scans · cache LLM hit rate ${
    rate === null || rate === undefined ? '—' : `${rate}%`
  }${detail}`
})

function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

/** Gaya mockup: Rp84,5rb / Rp1,2 jt / Rp0. */
function formatRupiah(value: number): string {
  const fmt = (n: number, digits = 1) =>
    new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits }).format(n)
  if (value >= 1_000_000) return `Rp${fmt(value / 1_000_000)} jt`
  if (value >= 1_000) return `Rp${fmt(value / 1_000)}rb`
  return `Rp${fmt(value, 0)}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [k, c] = await Promise.all([
      api<DashboardKpi>('/v1/admin/kpi', { token: auth.token }),
      api<ChartsData>('/v1/admin/charts', { token: auth.token }),
    ])
    kpi.value = k
    charts.value = c
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
      <p>{{ today }} · ringkasan 7–14 hari terakhir</p>
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

  <!-- KPI + chart (read-only) -->
  <template v-else-if="kpi && charts">
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
        delta="bukti misi menunggu review"
        tone="down"
      />
      <KpiCard
        icon="fa-coins"
        :label="`Biaya LLM (${new Date().toLocaleDateString('id-ID', { month: 'short' })})`"
        :value="formatRupiah(kpi.llm.cost_month)"
        :delta="
          kpi.llm.tokens_month > 0
            ? `${formatNumber(kpi.llm.tokens_month)} token bulan ini`
            : 'Rp0 — mode LLM mock'
        "
        tone="neutral"
      />
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-body chart">
          <div class="chart-kicker">
            Scan AI · {{ charts.days }} hari terakhir
          </div>
          <div class="chart-title">
            {{ dailyTotal > 0 ? `${formatNumber(dailyTotal)} scan dalam ${charts.days} hari terakhir` : 'Belum ada scan tercatat' }}
          </div>
          <div class="chart-sub">
            Jumlah pemindaian sampah per hari (semua pengguna)
          </div>
          <ChartLine
            :labels="dailyLabels"
            :values="dailyValues"
            :description="`Grafik garis: jumlah scan harian selama ${charts.days} hari, total ${dailyTotal} scan`"
            :foot="cacheFoot"
          />
        </div>
      </div>

      <div class="panel">
        <div class="panel-body chart">
          <div class="chart-kicker">
            Komposisi Kategori · 7 Hari
          </div>
          <div class="chart-title">
            {{ charts.categories.length > 0 ? `${charts.categories[0].name} mendominasi sampah hasil scan` : 'Belum ada data kategori' }}
          </div>
          <div class="chart-sub">
            Persentase kategori dari {{ formatNumber(charts.categories_total) }} scan minggu ini
          </div>
          <template v-if="charts.categories.length > 0">
            <ChartBar
              :labels="catLabels"
              :values="catValues"
              :description="`Grafik batang: komposisi kategori sampah 7 hari dari ${charts.categories_total} scan`"
              foot="Sumber: tabel scans · join waste_categories"
            />
          </template>
          <p
            v-else
            class="chart-empty"
          >
            Data kategori muncul setelah ada scan pengguna.
          </p>
        </div>
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
.chart-empty {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  padding: var(--space-5) 0;
  text-align: center;
}
</style>
