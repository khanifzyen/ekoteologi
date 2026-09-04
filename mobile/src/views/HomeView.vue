<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, apiUrl } from '@/api/client'
import BottomNav from '@/components/layout/BottomNav.vue'
import { fetchHistory } from '@/services/scan'
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
const scanTotal = ref<number | null>(null)

onMounted(async () => {
  try {
    await auth.ensureProfile()
  } catch (err) {
    // Header tetap tampil dengan nilai default; gagal jaringan tidak memblokir beranda.
    if (err instanceof ApiError && err.status === 0) toast.show('Menampilkan data lokal (luring).')
  } finally {
    headerLoading.value = false
  }
  // Hitungan riwayat untuk kartu menu (best-effort — tidak memblokir beranda).
  try {
    const page = await fetchHistory({ limit: 1 })
    scanTotal.value = page.total
  } catch {
    scanTotal.value = null
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
    <!-- Menu utama (beranda.html) — kartu scan signature + riwayat; penuh di Sprint 6 -->
    <div class="menu-grid">
      <button
        class="menu-card menu-ar"
        type="button"
        @click="router.push({ name: 'scan' })"
      >
        <i
          class="fas fa-camera"
          aria-hidden="true"
        />
        <strong>Scan Sampah "AR"</strong>
        <span>Kamera + AI · dapatkan poin</span>
      </button>
      <button
        class="menu-card"
        type="button"
        @click="router.push({ name: 'riwayat' })"
      >
        <i
          class="fas fa-clock-rotate-left"
          aria-hidden="true"
        />
        <strong>Riwayat Scan</strong>
        <span>
          <template v-if="scanTotal === null">Cek aktivitasmu</template>
          <template v-else-if="scanTotal === 0">Belum ada scan</template>
          <template v-else>{{ scanTotal }} scan tercatat</template>
        </span>
      </button>
      <button
        class="menu-card"
        type="button"
        @click="router.push({ name: 'misi' })"
      >
        <i
          class="fas fa-bullseye"
          aria-hidden="true"
        />
        <strong>Misi</strong>
        <span>Klaim poin kebaikan</span>
      </button>
      <button
        class="menu-card"
        type="button"
        @click="toast.show('E-Learning menyusul di Sprint 7.')"
      >
        <i
          class="fas fa-book-open"
          aria-hidden="true"
        />
        <strong>E-Learning</strong>
        <span>Segera hadir</span>
      </button>
    </div>
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

/* ── Menu grid (beranda.html) ── */
.menu-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
.menu-card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-1);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 108px;
  text-align: center;
  cursor: pointer;
  border: 1.5px solid transparent;
  transition: transform var(--dur-fast) var(--ease-out);
  font-family: var(--font-body);
}
.menu-card:hover {
  transform: translateY(-2px);
}
.menu-card:active {
  transform: scale(0.96);
}
.menu-card i {
  font-size: 24px;
  color: var(--color-primary);
}
.menu-card strong {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--color-text);
  font-family: var(--font-heading);
}
.menu-card span {
  font-size: 10px;
  color: var(--color-text-muted);
}
.menu-ar {
  grid-column: span 2;
  background: var(--color-header-grad);
  border-color: var(--color-surface);
  box-shadow: var(--shadow-2);
}
.menu-ar i {
  color: var(--gold-light);
  font-size: 28px;
}
.menu-ar strong {
  color: var(--color-on-dark);
  font-size: var(--text-md);
}
.menu-ar span {
  color: color-mix(in srgb, var(--color-on-dark) 80%, transparent);
}
</style>
