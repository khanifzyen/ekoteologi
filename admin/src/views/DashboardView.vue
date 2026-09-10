<script setup lang="ts">
/**
 * Dashboard admin (Sprint 3–4 → Sprint 10) — 4 KPI + 2 chart gaya editorial.
 * Sumber kini koleksi PocketBase bawaan: pengguna & antrian verifikasi
 * dihitung dari `users`/`user_missions` (rules memuat staff). Agregasi lintas
 * pengguna untuk scan/LLM/cache membutuhkan route kustom `$app.db` dan baru
 * dibangun Sprint 13 (rencana §5) — kartu terkait tampil jujur "menunggu".
 */
import { computed, onMounted, ref } from 'vue'

import { pb, toApiError } from '@/api/client'
import ChartLine from '@/components/ChartLine.vue'
import KpiCard from '@/components/KpiCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'

const loading = ref(true)
const error = ref('')
/** KPI terhitung dari koleksi (null saat masih memuat / error). */
const usersTotal = ref(0)
const usersNew7d = ref(0)
const pendingVerifications = ref(0)

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

/** 14 label hari terakhir (chart scan harian — nilai diisi setelah Sprint 13). */
const CHART_DAYS = 14
const dailyLabels = computed(() =>
  Array.from({ length: CHART_DAYS }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (CHART_DAYS - 1 - i))
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
  }),
)
const dailyValues = computed(() => Array.from({ length: CHART_DAYS }, () => 0))

async function countFiltered(collection: string, filter: string): Promise<number> {
  const page = await pb.collection(collection).getList(1, 1, { filter, fields: 'id' })
  return page.totalItems
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const since = new Date()
    since.setDate(since.getDate() - 7)
    const iso = since.toISOString().replace('T', ' ')
    const [total, new7d, pending] = await Promise.all([
      countFiltered('users', ''),
      countFiltered('users', `created >= "${iso}"`),
      countFiltered('user_missions', 'status = "submitted"'),
    ])
    usersTotal.value = total
    usersNew7d.value = new7d
    pendingVerifications.value = pending
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
      <p>{{ today }} · ringkasan koleksi PocketBase</p>
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
        label="Total Scan"
        value="—"
        delta="menunggu route agregasi (Sprint 13)"
        tone="neutral"
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
        value="Rp0"
        delta="mode LLM mock — live menyusul Sprint 11"
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
            Route agregasi dashboard menyusul (Sprint 13)
          </div>
          <div class="chart-sub">
            Jumlah pemindaian sampah per hari (semua pengguna)
          </div>
          <ChartLine
            :labels="dailyLabels"
            :values="dailyValues"
            :description="`Grafik garis: jumlah scan harian selama ${CHART_DAYS} hari (belum terisi)`"
            foot="Koleksi `scans` hanya terbaca pemiliknya — agregasi lintas pengguna butuh route kustom (Sprint 13)"
          />
        </div>
      </div>

      <div class="panel">
        <div class="panel-body chart">
          <div class="chart-kicker">
            Komposisi Kategori · 7 Hari
          </div>
          <div class="chart-title">
            Menunggu route agregasi dashboard (Sprint 13)
          </div>
          <div class="chart-sub">
            Persentase kategori dari scan minggu ini
          </div>
          <p class="chart-empty">
            Kategori hasil scan terisi setelah modul scan AI (Sprint 11) dan route
            agregasi dashboard (Sprint 13) aktif.
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
