<script setup lang="ts">
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  /** Tab aktif: home | misi | belajar | profil. */
  active: 'home' | 'misi' | 'belajar' | 'profil'
}>()

const toast = useToastStore()

// Layar tujuan dibangun bertahap (implementation-plan Sprint 3–7).
const items = [
  { key: 'home', label: 'Beranda', icon: 'fa-house', sprint: null },
  { key: 'misi', label: 'Misi', icon: 'fa-bullseye', sprint: 'Sprint 4' },
  { key: 'belajar', label: 'Belajar', icon: 'fa-book-open', sprint: 'Sprint 7' },
  { key: 'profil', label: 'Profil', icon: 'fa-user', sprint: null },
] as const

function onFab() {
  toast.show('Kamera scan tampil di Sprint 3.')
}

function onItem(item: (typeof items)[number]) {
  if (item.key !== props.active) toast.show(`Layar ${item.label} menyusul di ${item.sprint ?? 'sprint berikutnya'}.`)
}
</script>

<template>
  <div class="nav-wrap">
    <button
      class="fab"
      type="button"
      aria-label="Buka kamera scan (tampil di Sprint 3)"
      @click="onFab"
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
        v-for="item in items"
        :key="item.key"
        href="#"
        class="nav-item"
        :class="{ active: item.key === active }"
        :aria-current="item.key === active ? 'page' : undefined"
        @click.prevent="onItem(item)"
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
