<script setup lang="ts">
import { useToastStore } from '@/stores/toast'

import BaseCard from '@/components/ui/BaseCard.vue'

const toast = useToastStore()

const today = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).format(new Date())

// Navigasi bawah sesuai mockup beranda.html; layar tujuan dibangun di Sprint 1–7.
const navLeft = [
  { label: 'Beranda', icon: 'fa-house', active: true },
  { label: 'Misi', icon: 'fa-bullseye' }, // Sprint 4
]
const navRight = [
  { label: 'Belajar', icon: 'fa-book-open' }, // Sprint 7
  { label: 'Profil', icon: 'fa-user' }, // Sprint 1
]

function onNav(label: string) {
  toast.show(`Layar ${label} menyusul di sprint berikutnya.`)
}
</script>

<template>
  <!-- Header melengkung — signature mockup (base.css .header-curved) -->
  <header class="header-curved">
    <p class="greeting">
      {{ today }}
    </p>
    <div class="head-row">
      <h1 class="screen-title">
        Assalamu’alaikum
      </h1>
      <span class="level-pill">
        <i
          class="fas fa-seedling"
          aria-hidden="true"
        />
        Lvl 1 · Pemula
      </span>
    </div>
  </header>

  <main class="content-overlap">
    <BaseCard>
      <div class="empty">
        <div class="empty-icon">
          <i
            class="fas fa-camera"
            aria-hidden="true"
          />
        </div>
        <h3>Scan fitur pertama Anda</h3>
        <p>
          Ambil foto sampah lewat tombol kamera di bawah untuk mendapat poin dan saran
          pembuangan. Layar beranda lengkap tampil di Sprint 3–6.
        </p>
      </div>
    </BaseCard>
  </main>

  <!-- Bottom nav + FAB (base.css) — FAB tinggi 65px di tengah nav -->
  <div class="nav-wrap">
    <button
      class="fab"
      type="button"
      aria-label="Buka kamera scan (tampil di Sprint 3)"
      @click="toast.show('Kamera scan tampil di Sprint 3.')"
    >
      <i
        class="fas fa-camera"
        aria-hidden="true"
      />
    </button>
    <nav
      class="bottom-nav"
      aria-label="Navigasi utama"
    >
      <a
        v-for="item in navLeft"
        :key="item.label"
        href="#"
        class="nav-item"
        :class="{ active: item.active }"
        :aria-current="item.active ? 'page' : undefined"
        @click.prevent="!item.active && onNav(item.label)"
      >
        <i
          class="fas"
          :class="item.icon"
          aria-hidden="true"
        />
        {{ item.label }}
      </a>
      <span
        class="nav-spacer"
        aria-hidden="true"
      />
      <a
        v-for="item in navRight"
        :key="item.label"
        href="#"
        class="nav-item"
        @click.prevent="onNav(item.label)"
      >
        <i
          class="fas"
          :class="item.icon"
          aria-hidden="true"
        />
        {{ item.label }}
      </a>
    </nav>
  </div>
</template>

<style scoped>
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-2);
}
</style>
