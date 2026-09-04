<script setup lang="ts">
/**
 * Beranda (Sprint 6 — susunan final) — 1:1 mockup `beranda.html`:
 * header melengkung (sapaan, Poin Kebaikan, avatar, pill level) → kartu
 * streak → kartu dampak "Pohon Kebaikanmu" → kutipan harian (wisdom) →
 * misi hari ini (mini misi) → menu utama (Scan "AR", E-Learning, Misi,
 * Komunitas, Riwayat) → bottom nav + FAB. Notifikasi in-app tampil sebagai
 * "N hasil verifikasi baru" pada kartu Misi (Sprint 5).
 *
 * Pola widget best-effort (sejak Sprint 5): tiap widget punya skeleton dan
 * disembunyikan bila datanya gagal dimuat — satu widget gagal tidak
 * memblokir beranda; offline ditangani OfflineBar global (App.vue).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import ImpactCard from '@/components/home/ImpactCard.vue'
import StreakCard from '@/components/home/StreakCard.vue'
import WisdomCard from '@/components/home/WisdomCard.vue'
import BottomNav from '@/components/layout/BottomNav.vue'
import { ApiError, apiUrl } from '@/api/client'
import { fetchDailyContent } from '@/services/dailyContent'
import { fetchNotifications } from '@/services/notifications'
import { registerPush } from '@/services/push'
import { fetchMissions } from '@/services/missions'
import { fetchStreak } from '@/services/streak'
import { fetchHistory } from '@/services/scan'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import type { DailyContent } from '@/types/daily'
import type { Mission } from '@/types/mission'
import type { StreakStatus } from '@/types/streak'
import { pickMiniMissions } from '@/utils/home'

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
/** Kartu streak (Sprint 5). */
const streakLoading = ref(true)
const streak = ref<StreakStatus | null>(null)
/** Kartu dampak: total aksi nyata = scan bernilai poin + misi disetujui. */
const impactActions = computed(() => {
  const profile = auth.profile
  if (!profile) return null
  return (profile.scans_total ?? 0) + (profile.missions_approved ?? 0)
})
/** Kutipan harian (Sprint 6) — konten terjadwal atau fallback bank server. */
const wisdomLoading = ref(true)
const wisdom = ref<DailyContent | null>(null)
/** Mini misi "Misi Hari Ini" + hitungan utk kartu menu Misi. */
const missionsLoading = ref(true)
const missions = ref<Mission[]>([])
const miniMissions = computed(() => pickMiniMissions(missions.value))
/** Notif hasil verifikasi belum dibaca (badge kartu menu Misi — Sprint 5). */
const unreadMissions = ref(0)
const scanTotal = ref<number | null>(null)

function shareFallback(text: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.show('Kutipan disalin — tempel di WhatsApp-mu.'),
    () => toast.show('Tidak dapat membagikan di perangkat ini.'),
  )
}

onMounted(async () => {
  try {
    await auth.ensureProfile()
  } catch (err) {
    // Header tetap tampil dengan nilai default; gagal jaringan tidak memblokir beranda.
    if (err instanceof ApiError && err.status === 0) toast.show('Menampilkan data lokal (luring).')
  } finally {
    headerLoading.value = false
  }
  // Pendaftaran push FCM (Sprint 6) — best-effort, hanya di perangkat native.
  void registerPush()

  // Hitungan riwayat untuk kartu menu (best-effort — tidak memblokir beranda).
  try {
    const page = await fetchHistory({ limit: 1 })
    scanTotal.value = page.total
  } catch {
    scanTotal.value = null
  }
  try {
    streak.value = await fetchStreak()
  } catch {
    streak.value = null
  } finally {
    streakLoading.value = false
  }
  try {
    wisdom.value = await fetchDailyContent()
  } catch {
    wisdom.value = null
  } finally {
    wisdomLoading.value = false
  }
  try {
    const page = await fetchMissions()
    missions.value = page.items
  } catch {
    missions.value = []
  } finally {
    missionsLoading.value = false
  }
  try {
    const page = await fetchNotifications({ type: 'mission', limit: 1 })
    unreadMissions.value = page.unread_count
  } catch {
    unreadMissions.value = 0
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
      <div class="h-right">
        <div class="points">
          <strong data-testid="header-points">{{ auth.user?.points ?? 0 }}</strong>
          <span>Poin Kebaikan</span>
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
    </div>
    <span class="level-badge">
      <i
        class="fas fa-seedling"
        aria-hidden="true"
      />
      {{ levelLabel }}
    </span>
  </header>

  <main class="content-overlap">
    <!-- Kartu streak (Sprint 5 — pola streak-card `beranda.html`) -->
    <StreakCard
      v-if="streak"
      :streak="streak"
    />
    <div
      v-else-if="streakLoading"
      class="card streak-card skeleton-streak"
      aria-hidden="true"
    >
      <span class="skeleton sk-circle" />
      <div class="sk-lines">
        <div
          class="skeleton"
          style="width: 45%"
        />
        <div
          class="skeleton"
          style="width: 80%"
        />
      </div>
    </div>

    <!-- Kartu dampak (Sprint 6 — `impact-card` beranda.html) -->
    <ImpactCard
      v-if="impactActions !== null && !headerLoading"
      :total-actions="impactActions"
    />
    <div
      v-else-if="headerLoading"
      class="card impact-card skeleton-streak"
      aria-hidden="true"
    >
      <span class="skeleton sk-circle" />
      <div class="sk-lines">
        <div
          class="skeleton"
          style="width: 60%"
        />
        <div
          class="skeleton"
          style="width: 85%"
        />
      </div>
    </div>

    <!-- Kutipan harian (Sprint 6 — `wisdom` beranda.html) -->
    <WisdomCard
      v-if="wisdom"
      :content="wisdom"
      @share="shareFallback"
    />
    <div
      v-else-if="wisdomLoading"
      class="card wisdom skeleton-wisdom"
      aria-hidden="true"
    >
      <div class="skeleton wisdom-label-skeleton" />
      <div class="sk-lines">
        <div
          class="skeleton"
          style="width: 90%"
        />
        <div
          class="skeleton"
          style="width: 70%"
        />
        <div
          class="skeleton"
          style="width: 35%"
        />
      </div>
    </div>

    <!-- Misi hari ini (mini misi — `beranda.html`) -->
    <div class="section-head">
      <h2>Misi Hari Ini</h2>
      <button
        class="see-all"
        type="button"
        @click="router.push({ name: 'misi' })"
      >
        Lihat semua
        <i
          class="fas fa-angle-right"
          aria-hidden="true"
        />
      </button>
    </div>
    <div
      v-if="miniMissions.length > 0"
      class="card mini-missions"
    >
      <div
        v-for="mini in miniMissions"
        :key="mini.mission.id"
        class="mini-mission"
      >
        <div
          class="mm-icon"
          aria-hidden="true"
        >
          <i
            class="fas"
            :class="mini.mission.icon ?? 'fa-bullseye'"
          />
        </div>
        <div class="mm-info">
          <strong>{{ mini.mission.title }}</strong>
          <div class="pbar">
            <div
              class="pbar-fill"
              :style="{ width: `${mini.percent}%` }"
            />
          </div>
        </div>
        <div class="mm-points">
          <strong>+{{ mini.mission.points }}</strong>
          <span>{{ mini.progressLabel }}</span>
        </div>
      </div>
    </div>
    <div
      v-else-if="missionsLoading"
      class="card mini-missions"
      aria-hidden="true"
    >
      <div
        v-for="n in 2"
        :key="n"
        class="mini-mission"
      >
        <span class="skeleton sk-circle mm-skel" />
        <div class="sk-lines">
          <div
            class="skeleton"
            style="width: 75%"
          />
          <div
            class="skeleton"
            style="width: 50%"
          />
        </div>
      </div>
    </div>

    <!-- Menu utama (beranda.html) -->
    <div class="section-head">
      <h2>Menu Utama</h2>
    </div>
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
        @click="router.push({ name: 'belajar' })"
      >
        <i
          class="fas fa-book-open"
          aria-hidden="true"
        />
        <strong>E-Learning</strong>
        <span>Modul + kuis · dapatkan poin</span>
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
        <span>
          <template v-if="unreadMissions > 0">{{ unreadMissions }} hasil verifikasi baru</template>
          <template v-else-if="missions.length > 0">{{ missions.length }} misi hari ini</template>
          <template v-else>Klaim poin kebaikan</template>
        </span>
      </button>
      <button
        class="menu-card"
        type="button"
        @click="toast.show('Komunitas hadir di Fase 2 — pantau pembaruan aplikasi.')"
      >
        <i
          class="fas fa-map-location-dot"
          aria-hidden="true"
        />
        <strong>Komunitas</strong>
        <span>Segera hadir</span>
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
.h-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
/* Poin di header (mockup: "1.250 / Poin Kebaikan") */
.points {
  text-align: right;
}
.points strong {
  display: block;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: var(--text-xl);
  color: var(--gold-light);
  line-height: 1.1;
}
.points span {
  font-size: var(--text-xs);
  color: color-mix(in srgb, var(--color-on-dark) 80%, transparent);
}
/* Skeleton kartu streak/dampak (pola kartu beranda.html) */
.skeleton-streak {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.skeleton-streak .sk-circle {
  width: 44px;
  height: 44px;
  flex: none;
}
.skeleton-streak .sk-lines {
  flex: 1;
  display: grid;
  gap: var(--space-2);
}
/* Skeleton wisdom */
.skeleton-wisdom {
  margin-bottom: var(--space-4);
}
.wisdom-label-skeleton {
  width: 120px;
  height: 10px;
  margin-bottom: var(--space-3);
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
.level-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-3);
  background: color-mix(in srgb, var(--color-surface) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-surface) 35%, transparent);
  color: var(--color-on-dark);
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 700;
}
.level-badge i {
  color: var(--gold-light);
}

/* ── Misi mini (beranda.html) ── */
.mini-missions {
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
}
.mini-mission {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-border);
}
.mini-mission:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.mm-icon {
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: var(--radius-sm);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}
.mm-skel {
  width: 42px;
  height: 42px;
  border-radius: var(--radius-sm);
}
.mm-info {
  flex: 1;
  min-width: 0;
}
.mm-info strong {
  font-size: var(--text-sm);
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mm-info .pbar {
  margin-top: 6px;
  height: 6px;
}
.mm-points {
  flex: none;
  text-align: right;
}
.mm-points strong {
  font-family: var(--font-heading);
  color: var(--color-accent-text);
  font-size: var(--text-sm);
}
.mm-points span {
  display: block;
  font-size: 10px;
  color: var(--color-text-muted);
}
.see-all {
  border: none;
  background: none;
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-primary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
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
