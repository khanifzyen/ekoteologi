<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { ROLE_LABEL, useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

interface NavItem {
  label: string
  icon: string
  to?: string
  soon?: boolean
}

const auth = useAuthStore()
const toast = useToastStore()
const route = useRoute()
const router = useRouter()
const drawerOpen = ref(false)

const initials = computed(() =>
  (auth.user?.full_name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join(''),
)

// Modul sesuai sidebar mockup admin/index.html; item tanpa `to` = menyusul sprint berikutnya.
const mainNav: NavItem[] = [
  { label: 'Dashboard', icon: 'fa-gauge-high', to: '/' },
  { label: 'Pengguna', icon: 'fa-users', to: '/pengguna' }, // Sprint 4
  { label: 'Verifikasi Misi', icon: 'fa-clipboard-check', to: '/verifikasi' }, // Sprint 5
  { label: 'Misi', icon: 'fa-bullseye', to: '/misi' }, // Sprint 4
  { label: 'Konten Harian', icon: 'fa-calendar-day', to: '/konten' }, // Sprint 6
  { label: 'E-Learning', icon: 'fa-book-open' }, // Sprint 7
]
const systemNav: NavItem[] = [
  { label: 'Push Notifikasi', icon: 'fa-bell' }, // Sprint 8
  { label: 'Audit Log', icon: 'fa-list-check' }, // Sprint 8
  { label: 'Laporan', icon: 'fa-file-csv' }, // Sprint 8
]
const phase2Nav: NavItem[] = [
  { label: 'Reward', icon: 'fa-gift', soon: true },
  { label: 'Moderasi', icon: 'fa-comments', soon: true },
  { label: 'Peta', icon: 'fa-map-location-dot', soon: true },
]

function onNav(item: NavItem) {
  if (item.to) {
    drawerOpen.value = false
    return
  }
  toast.show(
    item.soon
      ? `${item.label} rencananya masuk Fase 2.`
      : `Modul ${item.label} menyusul di sprint berikutnya.`,
  )
}

function onLogout() {
  auth.logout()
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="shell">
    <!-- ═══ SIDEBAR ═══ -->
    <aside
      class="sidebar"
      :class="{ open: drawerOpen }"
      aria-label="Navigasi admin"
    >
      <div class="brand">
        <div class="mark">
          <i
            class="fas fa-seedling"
            aria-hidden="true"
          />
        </div>
        <div>
          <strong>Ekoteologi AR</strong>
          <span>Panel Admin</span>
        </div>
      </div>
      <nav class="nav">
        <template
          v-for="item in mainNav"
          :key="item.label"
        >
          <RouterLink
            v-if="item.to"
            :to="item.to"
            :class="{ active: route.path === item.to }"
            :aria-current="route.path === item.to ? 'page' : undefined"
            @click="drawerOpen = false"
          >
            <i
              class="fas"
              :class="item.icon"
              aria-hidden="true"
            />
            {{ item.label }}
          </RouterLink>
          <a
            v-else
            href="#"
            :aria-disabled="true"
            @click.prevent="onNav(item)"
          >
            <i
              class="fas"
              :class="item.icon"
              aria-hidden="true"
            />
            {{ item.label }}
          </a>
        </template>

        <div class="nav-label">
          Sistem
        </div>
        <template
          v-for="item in systemNav"
          :key="item.label"
        >
          <a
            href="#"
            :aria-disabled="true"
            @click.prevent="onNav(item)"
          >
            <i
              class="fas"
              :class="item.icon"
              aria-hidden="true"
            />
            {{ item.label }}
          </a>
        </template>

        <div class="nav-label">
          Fase 2
        </div>
        <template
          v-for="item in phase2Nav"
          :key="item.label"
        >
          <a
            href="#"
            :aria-disabled="true"
            @click.prevent="onNav(item)"
          >
            <i
              class="fas"
              :class="item.icon"
              aria-hidden="true"
            />
            {{ item.label }}
            <span
              v-if="item.soon"
              data-soon
            >Segera</span>
          </a>
        </template>
      </nav>
      <div class="side-user">
        <div
          class="avatar-initials"
          aria-hidden="true"
        >
          {{ initials }}
        </div>
        <div class="who">
          <strong>{{ auth.user?.full_name ?? '—' }}</strong>
          <span>{{ ROLE_LABEL[auth.user?.role ?? ''] ?? '—' }}</span>
        </div>
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          aria-label="Keluar"
          @click="onLogout"
        >
          <i
            class="fas fa-arrow-right-from-bracket"
            aria-hidden="true"
          />
        </button>
      </div>
    </aside>
    <div
      class="drawer-overlay"
      :class="{ show: drawerOpen }"
      @click="drawerOpen = false"
    />

    <!-- ═══ MAIN ═══ -->
    <div class="main">
      <header class="topbar">
        <button
          class="hamburger"
          type="button"
          aria-label="Buka menu navigasi"
          @click="drawerOpen = true"
        >
          <i
            class="fas fa-bars"
            aria-hidden="true"
          />
        </button>
        <div class="search">
          <i
            class="fas fa-magnifying-glass"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Cari pengguna, misi, konten…"
            aria-label="Cari (menyusul sprint berikutnya)"
            disabled
          >
        </div>
        <div class="top-right">
          <button
            class="top-icon"
            type="button"
            aria-label="Notifikasi (menyusul Sprint 8)"
            @click="toast.show('Notifikasi push tampil mulai Sprint 8.')"
          >
            <i
              class="fas fa-bell"
              aria-hidden="true"
            />
          </button>
          <div
            class="avatar-initials"
            aria-hidden="true"
          >
            {{ initials }}
          </div>
        </div>
      </header>

      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
