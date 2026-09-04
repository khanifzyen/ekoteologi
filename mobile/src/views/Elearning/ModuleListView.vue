<script setup lang="ts">
/**
 * E-Learning — daftar modul (Sprint 7) — 1:1 mockup `elearning.html`:
 * header melengkung dgn chip "N/M modul", kartu "Refleksi Hari Ini"
 * (konten harian — endpoint yang sama dgn beranda, satu sumber), lalu
 * daftar kartu modul dgn bar progres + CTA (Mulai/Lanjutkan/Ulangi).
 * State lengkap: skeleton, empty, error (+ Coba Lagi); offline via bar global.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import WisdomCard from '@/components/home/WisdomCard.vue'
import BottomNav from '@/components/layout/BottomNav.vue'
import StateEmpty from '@/components/state/StateEmpty.vue'
import StateError from '@/components/state/StateError.vue'
import { ApiError } from '@/api/client'
import { fetchDailyContent } from '@/services/dailyContent'
import { fetchModules } from '@/services/elearning'
import { useToastStore } from '@/stores/toast'
import type { DailyContent } from '@/types/daily'
import type { ModulesPage } from '@/types/elearning'
import { coverIcon, headerSummary, moduleCountLabel, modulePercent, progressLabel } from '@/utils/elearning'

const router = useRouter()
const toast = useToastStore()

const loading = ref(true)
const error = ref('')
const page = ref<ModulesPage | null>(null)
/** Refleksi hari ini — best-effort, tidak memblokir daftar modul. */
const wisdom = ref<DailyContent | null>(null)

const modules = computed(() => page.value?.items ?? [])
const summary = computed(() => page.value?.summary ?? { completed: 0, total: 0 })
const summaryLabel = computed(() => headerSummary(summary.value.completed, summary.value.total))

function shareFallback(text: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.show('Refleksi disalin — tempel di WhatsApp-mu.'),
    () => toast.show('Tidak dapat membagikan di perangkat ini.'),
  )
}

async function load() {
  error.value = ''
  loading.value = true
  try {
    page.value = await fetchModules()
  } catch (err) {
    error.value =
      err instanceof ApiError
        ? err.message
        : 'Gagal memuat modul. Periksa koneksi internetmu lalu coba lagi.'
  } finally {
    loading.value = false
  }
}

async function openModule(moduleId: number) {
  await router.push({ name: 'modul', params: { moduleId: String(moduleId) } })
}

onMounted(() => {
  void load()
  void fetchDailyContent()
    .then((c) => (wisdom.value = c))
    .catch(() => {
      /* refleksi best-effort — tidak memblokir daftar modul */
    })
})
</script>

<template>
  <header class="header-curved">
    <div class="el-top">
      <button
        class="back-btn"
        type="button"
        aria-label="Kembali"
        @click="router.back()"
      >
        <i
          class="fas fa-angle-left"
          aria-hidden="true"
        />
      </button>
      <h1 class="screen-title">
        E-Learning
      </h1>
      <span
        v-if="!loading && modules.length > 0"
        class="chip chip-gold"
      >
        <i
          class="fas fa-graduation-cap"
          aria-hidden="true"
        />
        {{ summaryLabel }}
      </span>
    </div>
  </header>

  <main class="content-overlap">
    <!-- Refleksi Hari Ini (konten harian — sumber sama dgn kartu wisdom beranda) -->
    <WisdomCard
      v-if="wisdom"
      :content="wisdom"
      label="Refleksi Hari Ini"
      @share="shareFallback"
    />

    <div class="section-head el-head">
      <h2>Modul Belajar</h2>
    </div>

    <!-- Skeleton -->
    <div
      v-if="loading"
      aria-label="Memuat modul"
    >
      <div
        v-for="n in 3"
        :key="n"
        class="card module-card sk-module"
        aria-hidden="true"
      >
        <span class="skeleton sk-cover" />
        <div class="mod-body">
          <div class="sk-lines">
            <div
              class="skeleton"
              style="width: 60%"
            />
            <div
              class="skeleton"
              style="width: 85%"
            />
            <div
              class="skeleton"
              style="width: 40%; height: 8px"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <StateError
      v-else-if="error"
      :message="error"
      @retry="load"
    />

    <!-- Empty -->
    <div
      v-else-if="modules.length === 0"
      class="card"
    >
      <StateEmpty
        icon="fa-book-open"
        title="Belum ada modul"
        text="Modul pembelajaran sedang disiapkan tim editor. Cek lagi nanti, ya."
      />
    </div>

    <!-- Daftar modul -->
    <template v-else>
      <article
        v-for="module in modules"
        :key="module.id"
        class="card module-card"
        data-testid="module-card"
      >
        <div
          class="mod-cover"
          aria-hidden="true"
        >
          <img
            v-if="module.cover_url && module.cover_url.startsWith('http')"
            :src="module.cover_url"
            alt=""
            width="64"
            height="64"
            loading="lazy"
          >
          <i
            v-else
            class="fas"
            :class="coverIcon(module.cover_url)"
          />
        </div>
        <div class="mod-body">
          <div class="mod-head">
            <h3>{{ module.title }}</h3>
            <span class="count">{{ moduleCountLabel(module) }}</span>
          </div>
          <p>{{ module.description }}</p>
          <div class="mod-foot">
            <div
              class="pbar"
              role="progressbar"
              :aria-valuenow="modulePercent(module)"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="`Progres ${module.title}`"
            >
              <div
                class="pbar-fill green"
                :style="{ width: `${modulePercent(module)}%` }"
              />
            </div>
            <span class="pct">{{ progressLabel(module) }}</span>
            <button
              class="btn btn-sm"
              :class="module.cta === 'Mulai' ? 'btn-secondary' : 'btn-primary'"
              type="button"
              data-testid="module-cta"
              @click="openModule(module.id)"
            >
              {{ module.cta }}
            </button>
          </div>
        </div>
      </article>
    </template>
  </main>

  <BottomNav active="belajar" />
</template>

<style scoped>
.el-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}
.el-top h1 {
  color: var(--color-on-dark);
  font-size: var(--text-xl);
  flex: 1;
}
.back-btn {
  min-width: 44px;
  min-height: 44px;
  border: 1px solid color-mix(in srgb, var(--color-surface) 40%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-surface) 14%, transparent);
  color: var(--color-on-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
}
.el-head {
  margin-top: var(--space-4);
}

/* ── Kartu modul (mockup .module-card) ── */
.module-card {
  display: flex;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.mod-cover {
  width: 64px;
  height: 64px;
  flex: none;
  border-radius: var(--radius-md);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  overflow: hidden;
}
.mod-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mod-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.mod-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-2);
}
.mod-head h3 {
  font-size: var(--text-md);
}
.mod-head .count {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}
.mod-body > p {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin: 2px 0 var(--space-3);
}
.mod-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  margin-top: auto;
}
.mod-foot .pbar {
  flex: 1;
  height: 6px;
}
.mod-foot .pct {
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--color-primary);
  white-space: nowrap;
}

/* Skeleton kartu modul */
.sk-module {
  align-items: center;
}
.sk-cover {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-md);
  flex: none;
}
</style>
