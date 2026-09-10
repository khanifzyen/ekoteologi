<script setup lang="ts">
/**
 * Dashboard admin (Sprint 3–4 → Sprint 13) — 4 KPI + 2 chart gaya editorial.
 * Sumber kini route agregasi hook PocketBase
 * `GET /api/ekoteologi/admin/dashboard` (sprint 13 — SQL `$app.db` tidak
 * tersedia di JSVM, agregasi dihitung server-side di hook; lihat
 * pocketbase/pb_hooks/ops.pb.js): pengguna, scan, antrian verifikasi,
 * cache hit rate, token/biaya LLM bulan berjalan, chart scan harian dan
 * komposisi kategori.
 */
import { computed, onMounted, ref } from 'vue'

import { pb, toApiError } from '@/api/client'
import ChartBar from '@/components/ChartBar.vue'
import ChartLine from '@/components/ChartLine.vue'
import KpiCard from '@/components/KpiCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'

const loading = ref(true)
const error = ref('')

interface DashboardPayload {
  users: { total: number; new_7d: number }
  scans: { today: number; total: number }
  verification: { pending: number }
  cache: { hit: number; miss: number; hit_rate: number | null }
  llm: { tokens_month: number; cost_month: number; budget_monthly: number | null }
  charts: {
    daily: Array<{ date: string; count: number }>
    categories: Array<{ name: string; icon: string; count: number; percentage: number }>
  }
}
const data = ref<DashboardPayload | null>(null)

function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

const today = computed(() =>
  new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date()),
)

const usersTotal = computed(() => data.value?.users.total ?? 0)
const usersNew7d = computed(() => data.value?.users.new_7d ?? 0)
const scansToday = computed(() => data.value?.scans.today ?? 0)
const scansTotal = computed(() => data.value?.scans.total ?? 0)
const pendingVerifications = computed(() => data.value?.verification.pending ?? 0)
const cacheRate = computed(() => data.value?.cache.hit_rate ?? null)
const llmCost = computed(() => data.value?.llm.cost_month ?? 0)
const llmTokens = computed(() => data.value?.llm.tokens_month ?? 0)

/** Chart garis: scan harian dari server (sudah berbentuk {date, count}). */
const CHART_DAYS = 14
const dailyLabels = computed(() => {
  const items = data.value?.charts.daily ?? []
  return items.map((d) =>
    new Date(`${d.date}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
  )
})
const dailyValues = computed(() => (data.value?.charts.daily ?? []).map((d) => d.count))

/** Chart batang: komposisi kategori 7 hari (label + persentase). */
const catLabels = computed(() => (data.value?.charts.categories ?? []).map((c) => c.name))
const catValues = computed(() => (data.value?.charts.categories ?? []).map((c) => c.percentage))

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await pb.send<DashboardPayload>('/api/ekoteologi/admin/dashboard', {
      method: 'GET',
      requestKey: null,
    })
  } catch (err) {
    error.value = toApiError(err).message
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
      <p>{{ today }} · ringkasan PocketBase via route agregasi</p>
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
  <template v-else>
    <div class="kpi-grid">
      <KpiCard
        icon="fa-users"
        label="Pengguna Terdaftar"
        :value="formatNumber(usersTotal)"
        :delta="`+${formatNumber(usersNew7d)} dalam 7 hari`"
        tone="up"
      />
      <KpiCard
        icon="fa-camera"
        label="Scan Sampah"
        :value="formatNumber(scansTotal)"
        :delta="`+${formatNumber(scansToday)} hari ini`"
        tone="up"
      />
      <KpiCard
        icon="fa-clipboard-check"
        label="Antrian Verifikasi"
        :value="formatNumber(pendingVerifications)"
        delta="bukti misi menunggu review"
        tone="down"
      />
      <KpiCard
        icon="fa-coins"
        :label="`Biaya LLM (${new Date().toLocaleDateString('id-ID', { month: 'short' })})`"
        :value="`Rp${formatNumber(llmCost)}`"
        :delta="
          cacheRate === null
            ? `${formatNumber(llmTokens)} token · cache belum terpakai`
            : `${formatNumber(llmTokens)} token · cache hit ${cacheRate}%`
        "
        tone="neutral"
      />
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-body chart">
          <div class="chart-kicker">
            Scan AI · {{ CHART_DAYS }} hari terakhir
          </div>
          <div class="chart-title">
            Jumlah pemindaian sampah per hari
          </div>
          <div class="chart-sub">
            Semua pengguna · sumber route agregasi hook
          </div>
          <ChartLine
            :labels="dailyLabels"
            :values="dailyValues"
            :description="`Grafik garis: jumlah scan harian selama ${CHART_DAYS} hari`"
            foot="Agregasi dihitung server-side (hook PocketBase) — scans tetap privat per pemilik"
          />
        </div>
      </div>

      <div class="panel">
        <div class="panel-body chart">
          <div class="chart-kicker">
            Komposisi Kategori · 7 Hari
          </div>
          <div class="chart-title">
            Kategori hasil scan minggu ini
          </div>
          <div class="chart-sub">
            Persentase dari total scan 7 hari terakhir
          </div>
          <template v-if="catLabels.length > 0">
            <ChartBar
              :labels="catLabels"
              :values="catValues"
              description="Grafik batang: komposisi kategori sampah 7 hari terakhir"
              foot="Kategori dicocokkan dari bank `waste_categories`"
            />
          </template>
          <p
            v-else
            class="chart-empty"
          >
            Belum ada scan dalam 7 hari terakhir — kartu ini terisi otomatis setelah
            scan pertama.
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
