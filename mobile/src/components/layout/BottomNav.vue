<script setup lang="ts">
import { useRouter } from 'vue-router'

import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  /** Tab aktif: home | misi | belajar | profil. */
  active: 'home' | 'misi' | 'belajar' | 'profil'
}>()

const router = useRouter()
const toast = useToastStore()

// Layar tujuan dibangun bertahap (implementation-plan Sprint 4–7).
const items = [
  { key: 'home', label: 'Beranda', icon: 'fa-house', to: 'home', sprint: null },
  { key: 'misi', label: 'Misi', icon: 'fa-bullseye', to: 'misi', sprint: null },
  { key: 'belajar', label: 'Belajar', icon: 'fa-book-open', to: null, sprint: 'Sprint 7' },
  { key: 'profil', label: 'Profil', icon: 'fa-user', to: 'profil', sprint: null },
] as const

// FAB kamera → layar scan (Sprint 3 — fitur signature).
function onFab() {
  void router.push({ name: 'scan' })
}

function onItem(item: (typeof items)[number]) {
  if (item.key === props.active) return
  if (item.to) {
    void router.push({ name: item.to })
    return
  }
  toast.show(`Layar ${item.label} menyusul di ${item.sprint ?? 'sprint berikutnya'}.`)
}
</script>

<template>
  <div class="nav-wrap">
    <button
      class="fab"
      type="button"
      aria-label="Buka pemindai sampah"
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
