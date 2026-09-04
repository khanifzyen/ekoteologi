<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, apiUrl } from '@/api/client'
import BottomNav from '@/components/layout/BottomNav.vue'
import StateEmpty from '@/components/state/StateEmpty.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const toast = useToastStore()
const auth = useAuthStore()

const today = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).format(new Date())

const greeting = computed(() =>
  auth.firstName ? `Assalamu’alaikum, ${auth.firstName}` : 'Assalamu’alaikum',
)
const levelLabel = computed(() => {
  if (!auth.profile) return 'Lvl 1 · Pemula'
  return `Lvl ${auth.profile.level} · ${auth.profile.level_title}`
})

const avatarSrc = computed(() => {
  const url = auth.user?.avatar_url
  return url ? apiUrl(url) : null
})

const headerLoading = ref(true)

onMounted(async () => {
  try {
    await auth.ensureProfile()
  } catch (err) {
    // Header tetap tampil dengan nilai default; gagal jaringan tidak memblokir beranda.
    if (err instanceof ApiError && err.status === 0) toast.show('Menampilkan data lokal (luring).')
  } finally {
    headerLoading.value = false
  }
})
</script>

<template>
  <!-- Header melengkung — signature mockup (base.css .header-curved) -->
  <header class="header-curved">
    <div class="home-top">
      <div class="h-greet">
        <p class="greeting">
          {{ today }}
        </p>
        <h1 class="screen-title">
          {{ greeting }}
        </h1>
        <p class="h-sub">
          Mari pilah sampah hari ini
        </p>
      </div>
      <button
        class="avatar"
        type="button"
        aria-label="Buka profil"
        @click="router.push({ name: 'profil' })"
      >
        <img
          v-if="avatarSrc"
          :src="avatarSrc"
          alt=""
        >
        <i
          v-else-if="!headerLoading"
          class="fas fa-user"
          aria-hidden="true"
        />
        <span
          v-else
          class="skeleton sk-circle"
        />
      </button>
    </div>
    <span class="level-pill">
      <i
        class="fas fa-seedling"
        aria-hidden="true"
      />
      {{ levelLabel }}
    </span>
  </header>

  <main class="content-overlap">
    <StateEmpty
      icon="fa-camera"
      title="Scan fitur pertama Anda"
      text="Ambil foto sampah lewat tombol kamera di bawah untuk mendapat poin dan saran pembuangan. Layar beranda lengkap tampil di Sprint 3–6."
    />
  </main>

  <BottomNav active="home" />
</template>

<style scoped>
.home-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-3);
}
.h-sub {
  font-size: var(--text-xs);
  opacity: 0.85;
  margin-top: 2px;
}
.avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid var(--gold);
  flex: none;
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar .sk-circle {
  width: 100%;
  height: 100%;
}
.level-pill {
  display: inline-flex;
  margin-top: var(--space-3);
}
</style>
