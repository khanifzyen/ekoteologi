<script setup lang="ts">
/**
 * Manajemen Pengguna (Sprint 4 → Sprint 10) — tabel user dgn badge
 * role/status, filter chips, pencarian, pagination. Sumber: koleksi
 * `users` PocketBase (list rule: authenticated); level dihitung dari
 * tangga koleksi `levels` (paritas endpoint agregasi lama).
 */
import { computed, onMounted, ref, watch } from 'vue'

import { pb, toApiError } from '@/api/client'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import { ROLE_LABEL } from '@/stores/auth'

interface AdminUser {
  id: string
  full_name: string
  email: string | null
  city: string | null
  points: number
  role: string
  is_active: boolean
  level: number
  level_title: string
  created_at: string
}

interface UsersPageData {
  items: AdminUser[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 20

const loading = ref(true)
const error = ref('')
const page = ref<UsersPageData | null>(null)
const activeFilter = ref<'all' | 'user' | 'verifier' | 'editor' | 'admin' | 'blocked'>('all')
const search = ref('')
const offset = ref(0)

const filters = [
  { key: 'all', label: 'Semua', icon: '' },
  { key: 'user', label: 'User', icon: 'fa-user' },
  { key: 'verifier', label: 'Verifier', icon: 'fa-clipboard-check' },
  { key: 'editor', label: 'Editor', icon: 'fa-pen-nib' },
  { key: 'admin', label: 'Admin', icon: 'fa-shield-halved' },
  { key: 'blocked', label: 'Nonaktif', icon: 'fa-circle-half-stroke' },
] as const

interface LevelRow {
  level: number
  min_points: number
  title: string
}
const levelLadder = ref<LevelRow[]>([])

const currentPage = computed(() =>
  page.value ? Math.floor(page.value.offset / page.value.limit) + 1 : 1,
)
const totalPages = computed(() =>
  page.value ? Math.max(1, Math.ceil(page.value.total / page.value.limit)) : 1,
)
const rangeLabel = computed(() => {
  if (!page.value || page.value.total === 0) return 'Tidak ada pengguna'
  const from = page.value.offset + 1
  const to = Math.min(page.value.offset + page.value.limit, page.value.total)
  return `Menampilkan ${from}–${to} dari ${formatNumber(page.value.total)} pengguna`
})

function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function roleBadgeClass(role: string): string {
  return `badge-${role in ROLE_LABEL ? role : 'user'}`
}

function levelOf(points: number): LevelRow {
  let current = levelLadder.value[0]
  for (const row of levelLadder.value) {
    if (points >= row.min_points) current = row
  }
  return current ?? { level: 1, min_points: 0, title: 'Pemula' }
}

function setFilter(key: (typeof filters)[number]['key']) {
  activeFilter.value = key
  offset.value = 0
  void load()
}

function gotoPage(p: number) {
  offset.value = (p - 1) * PAGE_SIZE
  void load()
}

async function load() {
  loading.value = true
  error.value = ''
  const clauses: string[] = []
  if (['user', 'verifier', 'editor', 'admin'].includes(activeFilter.value)) {
    clauses.push(`role = "${activeFilter.value}"`)
  }
  if (activeFilter.value === 'blocked') clauses.push('is_active = false')
  if (search.value.trim()) {
    const q = search.value.trim().replace(/"/g, '')
    clauses.push(`(full_name ~ "${q}" || email ~ "${q}" || city ~ "${q}")`)
  }
  try {
    if (levelLadder.value.length === 0) {
      levelLadder.value = await pb.collection('levels').getFullList<LevelRow>({ sort: 'level' })
    }
    const result = await pb.collection('users').getList<Record<string, unknown>>(
      Math.floor(offset.value / PAGE_SIZE) + 1,
      PAGE_SIZE,
      { filter: clauses.join(' && '), sort: '-created' },
    )
    const items: AdminUser[] = result.items.map((row) => {
      const points = Number(row.points ?? 0)
      const level = levelOf(points)
      return {
        id: String(row.id),
        full_name: String(row.full_name ?? ''),
        email: (row.email as string) ?? null,
        city: (row.city as string) || null,
        points,
        role: (row.role as string) || 'user',
        is_active: row.is_active !== false,
        level: level.level,
        level_title: level.title,
        created_at: String(row.created ?? ''),
      }
    })
    page.value = { items, total: result.totalItems, limit: PAGE_SIZE, offset: offset.value }
  } catch (err) {
    error.value = toApiError(err).message
  } finally {
    loading.value = false
  }
}

// Cari: debounce sederhana 400ms.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    offset.value = 0
    void load()
  }, 400)
})

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Manajemen Pengguna</h1>
      <p>Cari &amp; tinjau akun terdaftar (read-only — aksi kelola menyusul)</p>
    </div>
  </div>

  <div class="panel">
    <div
      class="filters"
      role="group"
      aria-label="Filter pengguna"
    >
      <button
        v-for="f in filters"
        :key="f.key"
        class="f-chip"
        :class="{ on: activeFilter === f.key }"
        type="button"
        :aria-pressed="activeFilter === f.key"
        @click="setFilter(f.key)"
      >
        <i
          v-if="f.icon"
          class="fas"
          :class="f.icon"
          aria-hidden="true"
        />
        {{ f.label }}
      </button>
      <span class="filter-spacer" />
      <div class="search-mini">
        <i
          class="fas fa-magnifying-glass"
          aria-hidden="true"
        />
        <input
          v-model="search"
          type="search"
          placeholder="Cari nama, email, kota…"
          aria-label="Cari pengguna"
        >
      </div>
    </div>

    <!-- Loading -->
    <div
      v-if="loading"
      class="panel-body"
      aria-label="Memuat daftar pengguna"
    >
      <div
        v-for="n in 5"
        :key="n"
        class="sk-row"
      >
        <BaseSkeleton />
      </div>
    </div>

    <!-- Error -->
    <div
      v-else-if="error"
      class="panel-body users-error"
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

    <!-- Empty -->
    <div
      v-else-if="!page || page.items.length === 0"
      class="panel-body users-empty"
    >
      <i
        class="fas fa-user-slash"
        aria-hidden="true"
      />
      <p>Tidak ada pengguna yang cocok dengan filter.</p>
    </div>

    <!-- Tabel -->
    <template v-else>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Pengguna</th>
              <th>Kota</th>
              <th>Poin</th>
              <th>Level</th>
              <th>Role</th>
              <th>Status</th>
              <th>Terdaftar</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="u in page.items"
              :key="u.id"
            >
              <td data-label="Pengguna">
                <div class="cell-user">
                  <div
                    class="avatar-initials small"
                    aria-hidden="true"
                  >
                    {{ initials(u.full_name) }}
                  </div>
                  <div>
                    <strong>{{ u.full_name }}</strong>
                    <span>{{ u.email ?? '—' }}</span>
                  </div>
                </div>
              </td>
              <td data-label="Kota">
                {{ u.city ?? '—' }}
              </td>
              <td data-label="Poin">
                <strong class="num">{{ formatNumber(u.points) }}</strong>
              </td>
              <td data-label="Level">
                Lv {{ u.level }} · {{ u.level_title }}
              </td>
              <td data-label="Role">
                <span
                  class="badge"
                  :class="roleBadgeClass(u.role)"
                >{{ ROLE_LABEL[u.role] ?? u.role }}</span>
              </td>
              <td data-label="Status">
                <span
                  class="badge"
                  :class="u.is_active ? 'badge-active' : 'badge-blocked'"
                ><i
                  class="fas"
                  :class="u.is_active ? 'fa-circle' : 'fa-ban'"
                  aria-hidden="true"
                /> {{ u.is_active ? 'Aktif' : 'Nonaktif' }}</span>
              </td>
              <td
                data-label="Terdaftar"
                class="num"
              >
                {{ formatDate(u.created_at) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="table-foot">
        <span>{{ rangeLabel }}</span>
        <div
          class="pager"
          role="navigation"
          aria-label="Halaman"
        >
          <button
            type="button"
            :disabled="currentPage <= 1"
            aria-label="Halaman sebelumnya"
            @click="gotoPage(currentPage - 1)"
          >
            <i
              class="fas fa-angle-left"
              aria-hidden="true"
            />
          </button>
          <button
            class="on"
            type="button"
            aria-current="page"
          >
            {{ currentPage }}
          </button>
          <button
            v-if="currentPage < totalPages"
            type="button"
            @click="gotoPage(currentPage + 1)"
          >
            {{ currentPage + 1 }}
          </button>
          <button
            type="button"
            :disabled="currentPage >= totalPages"
            aria-label="Halaman berikutnya"
            @click="gotoPage(currentPage + 1)"
          >
            <i
              class="fas fa-angle-right"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.filter-spacer {
  flex: 1;
}
.search-mini {
  position: relative;
  min-width: 220px;
}
.search-mini i {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ink-400);
  font-size: var(--text-xs);
}
.search-mini input {
  width: 100%;
  min-height: 32px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-pill);
  padding: 0 var(--space-3) 0 30px;
  font-family: var(--font-body);
  font-size: var(--text-xs);
  background: var(--color-surface);
}
.search-mini input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 22%, transparent);
}
.sk-row {
  padding: var(--space-2) 0;
}
.users-error {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-danger-strong);
  flex-wrap: wrap;
}
.users-empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: var(--space-6);
}
.users-empty i {
  font-size: var(--text-xl);
  display: block;
  margin-bottom: var(--space-2);
}
.avatar-initials.small {
  width: 34px;
  height: 34px;
  font-size: var(--text-xs);
}
@media (max-width: 767px) {
  .search-mini {
    width: 100%;
  }
}
</style>
