<script setup lang="ts">
import { useRouter } from 'vue-router'

const props = defineProps<{
  /** Tab aktif: home | misi | belajar | profil. */
  active: 'home' | 'misi' | 'belajar' | 'profil'
}>()

const router = useRouter()

// Layar tujuan (beranda/misi/profil hidup Sprint 4–6; belajar Sprint 7).
const items = [
  { key: 'home', label: 'Beranda', icon: 'fa-house', to: 'home' },
  { key: 'misi', label: 'Misi', icon: 'fa-bullseye', to: 'misi' },
  { key: 'belajar', label: 'Belajar', icon: 'fa-book-open', to: 'belajar' },
  { key: 'profil', label: 'Profil', icon: 'fa-user', to: 'profil' },
] as const

// FAB kamera → layar scan (Sprint 3 — fitur signature).
function onFab() {
  void router.push({ name: 'scan' })
}

function onItem(item: (typeof items)[number]) {
  if (item.key === props.active) return
  void router.push({ name: item.to })
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
