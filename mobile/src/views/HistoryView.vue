<script setup lang="ts">
/**
 * Riwayat scan + filter kategori (Sprint 3) — acuan menu "Riwayat Scan"
 * `beranda.html` & tombol Riwayat di `scan.html`. State lengkap: skeleton,
 * empty, error + coba lagi, offline (OfflineBar global), tombol "Muat lagi".
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, apiUrl } from '@/api/client'
import StateEmpty from '@/components/state/StateEmpty.vue'
import StateError from '@/components/state/StateError.vue'
import StateSkeleton from '@/components/state/StateSkeleton.vue'
import { fetchCategories, fetchHistory } from '@/services/scan'
import type { ScanCategoryFull, ScanHistoryItem } from '@/types/scan'
import { relativeDay, formatTime } from '@/utils/datetime'

const router = useRouter()

const PAGE_SIZE = 20

const loading = ref(true)
const error = ref('')
const items = ref<ScanHistoryItem[]>([])
const total = ref(0)
const categories = ref<ScanCategoryFull[]>([])
const activeCategory = ref<number | null>(null)
const offset = ref(0)
const loadingMore = ref(false)

const hasMore = computed(() => items.value.length < total.value)

onMounted(() => {
  void load(true)
})

async function load(reset: boolean) {
  error.value = ''
  if (reset) {
    loading.value = true
    offset.value = 0
  } else {
    loadingMore.value = true
  }
  try {
    const [page, cats] = await Promise.all([
      fetchHistory({
        categoryId: activeCategory.value ?? undefined,
        limit: PAGE_SIZE,
        offset: offset.value,
      }),
      // Kategori hanya diambil sekali saat reset (filter chips).
      reset && categories.value.length === 0 ? fetchCategories() : Promise.resolve(categories.value),
    ])
    items.value = reset ? page.items : [...items.value, ...page.items]
    total.value = page.total
    categories.value = cats
  } catch (err) {
    error.value =
      err instanceof ApiError && err.status === 0
        ? 'Tidak dapat terhubung ke server. Periksa koneksi Anda.'
        : err instanceof ApiError
          ? err.message
          : 'Terjadi kesalahan saat memuat riwayat.'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function setCategory(id: number | null) {
  if (activeCategory.value === id) return
  activeCategory.value = id
  void load(true)
}

function loadMore() {
  offset.value = items.value.length
  void load(false)
}

function categoryClass(name: string | null | undefined): string {
  return `tag-cat-${(name ?? 'lainnya').toLowerCase()}`
}
</script>

<template>
  <header class="header-curved history-head">
    <div class="head-row">
      <button
        class="icon-btn-ghost"
        type="button"
        aria-label="Kembali ke beranda"
        @click="router.back()"
      >
        <i
          class="fas fa-arrow-left"
          aria-hidden="true"
        />
      </button>
      <div>
        <h1 class="screen-title">
          Riwayat Scan
        </h1>
        <p class="head-sub">
          <template v-if="!loading">
            {{ total }} scan tercatat
          </template>
          <template v-else>
            Memuat riwayat…
          </template>
        </p>
      </div>
      <button
        class="icon-btn-ghost"
        type="button"
        aria-label="Scan baru"
        @click="router.push({ name: 'scan' })"
      >
        <i
          class="fas fa-camera"
          aria-hidden="true"
        />
      </button>
    </div>
  </header>

  <main class="content-plain history-body">
    <!-- Filter kategori -->
    <div
      class="filter-row"
      role="group"
      aria-label="Filter kategori sampah"
    >
      <button
        class="f-chip"
        :class="{ on: activeCategory === null }"
        type="button"
        :aria-pressed="activeCategory === null"
        @click="setCategory(null)"
      >
        Semua
      </button>
      <button
        v-for="cat in categories"
        :key="cat.id"
        class="f-chip"
        :class="{ on: activeCategory === cat.id }"
        type="button"
        :aria-pressed="activeCategory === cat.id"
        @click="setCategory(cat.id)"
      >
        {{ cat.name }}
      </button>
    </div>

    <!-- Loading -->
    <StateSkeleton
      v-if="loading"
      :rows="4"
    />

    <!-- Error -->
    <StateError
      v-else-if="error"
      :message="error"
      @retry="load(true)"
    />

    <!-- Empty -->
    <div
      v-else-if="items.length === 0"
      class="card"
    >
      <StateEmpty
        icon="fa-clock-rotate-left"
        :title="activeCategory ? 'Belum ada scan di kategori ini' : 'Belum ada riwayat scan'"
        :text="activeCategory ? 'Coba pilih kategori lain, atau scan objek baru.' : 'Scan sampah pertamamu untuk mulai mengumpulkan poin kebaikan.'"
      >
        <button
          class="btn btn-primary"
          type="button"
          @click="router.push({ name: 'scan' })"
        >
          <i
            class="fas fa-camera"
            aria-hidden="true"
          />
          Mulai Scan
        </button>
      </StateEmpty>
    </div>

    <!-- Daftar -->
    <template v-else>
      <ol class="history-list">
        <li
          v-for="(item, index) in items"
          :key="item.id"
        >
          <p
            v-if="index === 0 || relativeDay(items[index - 1].created_at) !== relativeDay(item.created_at)"
            class="day-label"
          >
            {{ relativeDay(item.created_at) }}
          </p>
          <article class="card history-card">
            <div
              class="thumb"
              aria-hidden="true"
            >
              <img
                v-if="item.image_url"
                :src="apiUrl(item.image_url)"
                alt=""
                width="56"
                height="56"
                loading="lazy"
              >
              <i
                v-else
                class="fas fa-image"
              />
            </div>
            <div class="history-info">
              <strong class="item-name">{{ item.item_name ?? 'Objek tidak dikenali' }}</strong>
              <span class="item-meta">
                <span
                  class="tag"
                  :class="categoryClass(item.category?.name)"
                >{{ item.category?.name ?? 'Lainnya' }}</span>
                <span class="item-time">{{ formatTime(item.created_at) }}</span>
              </span>
            </div>
            <div
              class="history-points"
              :class="{ zero: item.points === 0 }"
            >
              <strong>+{{ item.points }}</strong>
              <span>poin</span>
            </div>
          </article>
        </li>
      </ol>

      <button
        v-if="hasMore"
        class="btn btn-secondary btn-block load-more"
        type="button"
        :disabled="loadingMore"
        @click="loadMore"
      >
        <span
          v-if="loadingMore"
          class="spinner dark"
          aria-hidden="true"
        />
        {{ loadingMore ? 'Memuat…' : `Muat lagi (${total - items.length} tersisa)` }}
      </button>
      <p
        v-else
        class="list-end"
      >
        Semua riwayat sudah tampil
      </p>
    </template>
  </main>
</template>

<style scoped>
.history-head {
  padding-bottom: var(--space-5);
}
.head-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.head-row > div {
  flex: 1;
}
.head-sub {
  font-size: var(--text-xs);
  color: color-mix(in srgb, var(--color-on-dark) 82%, transparent);
}
.icon-btn-ghost {
  min-width: 44px;
  min-height: 44px;
  border: 1px solid color-mix(in srgb, var(--color-surface) 35%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-surface) 16%, transparent);
  color: var(--color-on-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
}
.history-body {
  margin-top: -40px;
  position: relative;
  z-index: 2;
  padding-bottom: var(--space-7);
}
.filter-row {
  display: flex;
  gap: var(--space-2);
  overflow-x: auto;
  padding: var(--space-2) 0 var(--space-3);
  scrollbar-width: none;
}
.filter-row::-webkit-scrollbar {
  display: none;
}
.f-chip {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text-muted);
  border-radius: var(--radius-pill);
  min-height: 44px;
  padding: 0 var(--space-4);
  font-size: var(--text-sm);
  font-weight: 600;
  font-family: var(--font-body);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.f-chip.on {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-primary-fg);
}
.history-list {
  list-style: none;
  display: grid;
  gap: var(--space-3);
}
.day-label {
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--color-text-muted);
  margin: var(--space-2) 0 0;
}
.history-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}
.thumb {
  width: 56px;
  height: 56px;
  flex: none;
  border-radius: var(--radius-sm);
  background: var(--surface-alt);
  border: 1px solid var(--color-border);
  color: var(--ink-300);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.history-info {
  flex: 1;
  min-width: 0;
}
.item-name {
  display: block;
  font-family: var(--font-heading);
  font-size: var(--text-sm);
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: 4px;
}
.tag {
  font-size: var(--text-xs);
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
}
.tag-cat-organik { background: var(--cat-organik-soft); color: var(--cat-organik); }
.tag-cat-plastik { background: var(--cat-plastik-soft); color: var(--cat-plastik); }
.tag-cat-kertas { background: var(--cat-residu-soft); color: var(--cat-residu); }
.tag-cat-kaca { background: var(--cat-plastik-soft); color: var(--cat-plastik); }
.tag-cat-logam { background: var(--surface-alt); color: var(--color-text); }
.tag-cat-b3 { background: var(--cat-b3-soft); color: var(--cat-b3); }
.tag-cat-residu { background: var(--cat-residu-soft); color: var(--cat-residu); }
.tag-cat-lainnya { background: var(--color-primary-soft); color: var(--color-primary-strong); }
.item-time {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.history-points {
  text-align: right;
  flex: none;
}
.history-points strong {
  font-family: var(--font-heading);
  font-weight: 800;
  color: var(--color-accent-text);
  display: block;
  line-height: 1.1;
}
.history-points.zero strong {
  color: var(--color-text-muted);
}
.history-points span {
  font-size: 10px;
  color: var(--color-text-muted);
}
.load-more {
  margin-top: var(--space-4);
}
.list-end {
  text-align: center;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-top: var(--space-4);
}
</style>
