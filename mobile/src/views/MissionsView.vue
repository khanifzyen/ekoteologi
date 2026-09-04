<script setup lang="ts">
/**
 * Layar Misi (Sprint 4) — 1:1 mockup `misi.html`: header melengkung dgn panel
 * progres mingguan, tab Harian (kartu misi 4 keadaan) & Pencapaian (lencana),
 * state lengkap (skeleton/empty/error), dan alur unggah bukti photo:
 * pilih foto → consent (PRD §9, kartu reusable Sprint 3) → kirim ke antrian.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError } from '@/api/client'
import MissionCard from '@/components/missions/MissionCard.vue'
import ConsentCard from '@/components/scan/ConsentCard.vue'
import StateEmpty from '@/components/state/StateEmpty.vue'
import StateError from '@/components/state/StateError.vue'
import StateSkeleton from '@/components/state/StateSkeleton.vue'
import { claimPhoto, fetchBadges, fetchMissions } from '@/services/missions'
import { useToastStore } from '@/stores/toast'
import type { BadgeItem, Mission } from '@/types/mission'
import { hasFotoConsent, grantFotoConsent } from '@/utils/consent'
import { countNewMissions, describeClaimError, weekPercent } from '@/utils/missions'

const router = useRouter()
const toast = useToastStore()

const loading = ref(true)
const error = ref('')
const missions = ref<Mission[]>([])
const summary = ref({ week_done: 0, week_total: 0, week_points: 0 })
const badges = ref<BadgeItem[]>([])
const badgesLoading = ref(false)
const badgesError = ref('')
const tab = ref<'harian' | 'pencapaian'>('harian')

const percent = computed(() => weekPercent(summary.value.week_done, summary.value.week_total))
const newCount = computed(() => countNewMissions(missions.value))

async function load() {
  error.value = ''
  loading.value = true
  try {
    const page = await fetchMissions()
    missions.value = page.items
    summary.value = page.summary
  } catch (err) {
    error.value =
      err instanceof ApiError
        ? err.message
        : 'Gagal memuat misi. Periksa koneksi internetmu lalu coba lagi.'
  } finally {
    loading.value = false
  }
}

async function loadBadges() {
  badgesError.value = ''
  badgesLoading.value = true
  try {
    badges.value = await fetchBadges()
  } catch (err) {
    badgesError.value =
      err instanceof ApiError ? err.message : 'Gagal memuat lencana. Coba lagi.'
  } finally {
    badgesLoading.value = false
  }
}

function setTab(next: 'harian' | 'pencapaian') {
  tab.value = next
  if (next === 'pencapaian' && badges.value.length === 0) void loadBadges()
}

onMounted(() => {
  void load()
})

// ── Alur klaim photo (sheet unggah bukti) ──
const claimMission = ref<Mission | null>(null)
const needConsent = ref(false)
const photo = ref<Blob | null>(null)
const photoUrl = ref('')
const submitting = ref(false)
const sheetTitle = ref<HTMLElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)
const galleryInput = ref<HTMLInputElement | null>(null)

function openClaim(mission: Mission) {
  claimMission.value = mission
  needConsent.value = !hasFotoConsent()
  photo.value = null
  photoUrl.value = ''
  // Fokus ke judul sheet utk pembaca layar (pola sheet hasil scan).
  requestAnimationFrame(() => sheetTitle.value?.focus())
}

function closeClaim() {
  if (submitting.value) return
  claimMission.value = null
  needConsent.value = false
  photo.value = null
  if (photoUrl.value) URL.revokeObjectURL(photoUrl.value)
  photoUrl.value = ''
}

function agreeConsent() {
  grantFotoConsent()
  needConsent.value = false
}

function pickCamera() {
  cameraInput.value?.click()
}

function pickGallery() {
  galleryInput.value?.click()
}

function onPhotoChange(event: Event, source: HTMLInputElement | null) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    if (photoUrl.value) URL.revokeObjectURL(photoUrl.value)
    photo.value = file
    photoUrl.value = URL.createObjectURL(file)
  }
  if (source) source.value = ''
}

async function submitClaim() {
  const mission = claimMission.value
  if (!mission || !photo.value || submitting.value) return
  submitting.value = true
  try {
    const result = await claimPhoto(mission.id, photo.value, true)
    toast.show(result.message)
    closeClaim()
    void load()
  } catch (err) {
    const content = describeClaimError(
      err instanceof ApiError ? err.status : -1,
      err instanceof ApiError ? err.message : '',
    )
    toast.show(`${content.title} — ${content.message}`)
  } finally {
    submitting.value = false
  }
}

function onUnavailable() {
  toast.show('Klaim misi manual & auto_scan menyusul di Sprint 5.')
}
</script>

<template>
  <header class="header-curved mission-head">
    <div class="mission-top">
      <button
        class="back-btn"
        type="button"
        aria-label="Kembali ke beranda"
        @click="router.back()"
      >
        <i
          class="fas fa-angle-left"
          aria-hidden="true"
        />
      </button>
      <h1 class="screen-title">
        Misi Kebaikan
      </h1>
      <span
        v-if="newCount > 0 && !loading"
        class="chip chip-gold"
      >
        <i
          class="fas fa-bolt"
          aria-hidden="true"
        />
        {{ newCount }} misi baru
      </span>
    </div>
    <div class="weekly">
      <div class="row">
        <span>Progres misi minggu ini</span>
        <strong>{{ summary.week_done }}/{{ summary.week_total }} · +{{ summary.week_points }} poin</strong>
      </div>
      <div
        class="track"
        role="progressbar"
        :aria-valuenow="percent"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="Progres misi mingguan"
      >
        <div
          class="fill"
          :style="{ width: `${percent}%` }"
        />
      </div>
    </div>
  </header>

  <main class="content-overlap">
    <div
      class="tabs"
      role="tablist"
      aria-label="Tab misi"
    >
      <button
        class="tab-btn"
        :class="{ active: tab === 'harian' }"
        role="tab"
        :aria-selected="tab === 'harian'"
        type="button"
        @click="setTab('harian')"
      >
        Harian
      </button>
      <button
        class="tab-btn"
        :class="{ active: tab === 'pencapaian' }"
        role="tab"
        :aria-selected="tab === 'pencapaian'"
        type="button"
        @click="setTab('pencapaian')"
      >
        Pencapaian
      </button>
    </div>

    <!-- ═══ TAB HARIAN ═══ -->
    <section
      v-show="tab === 'harian'"
      id="pane-harian"
      role="tabpanel"
      aria-label="Misi harian"
    >
      <StateSkeleton
        v-if="loading"
        :rows="4"
      />
      <StateError
        v-else-if="error"
        :message="error"
        @retry="load"
      />
      <div
        v-else-if="missions.length === 0"
        class="card"
      >
        <StateEmpty
          icon="fa-mug-hot"
          title="Semua misi selesai!"
          text="Misi baru muncul setiap pagi pukul 05.00. Scan sampah untuk tambah poin."
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
            Scan Sekarang
          </button>
        </StateEmpty>
      </div>
      <template v-else>
        <MissionCard
          v-for="mission in missions"
          :key="mission.id"
          :mission="mission"
          @claim-photo="openClaim(mission)"
          @claim-unavailable="onUnavailable"
        />
      </template>
    </section>

    <!-- ═══ TAB PENCAPAIAN ═══ -->
    <section
      v-show="tab === 'pencapaian'"
      id="pane-pencapaian"
      role="tabpanel"
      aria-label="Lencana pencapaian"
    >
      <div class="section-head">
        <h2>Lencana</h2>
        <span
          v-if="!badgesLoading && badges.length > 0"
          class="chip chip-green"
        >
          {{ badges.filter((b) => b.earned).length }} dari {{ badges.length }}
        </span>
      </div>
      <div class="card">
        <div
          v-if="badgesLoading"
          class="badge-grid"
          aria-label="Memuat lencana"
        >
          <div
            v-for="n in 8"
            :key="n"
            class="badge-cell"
          >
            <div class="badge-medal">
              <span class="skeleton sk-circle" />
            </div>
          </div>
        </div>
        <div
          v-else-if="badgesError"
          class="error-box"
          role="alert"
        >
          <i
            class="fas fa-triangle-exclamation"
            aria-hidden="true"
          />
          <p>{{ badgesError }}</p>
          <button
            class="btn btn-primary btn-sm"
            type="button"
            @click="loadBadges"
          >
            <i
              class="fas fa-rotate-right"
              aria-hidden="true"
            />
            Coba Lagi
          </button>
        </div>
        <p
          v-else-if="badges.length === 0"
          class="badge-empty"
        >
          Lencana belum tersedia.
        </p>
        <div
          v-else
          class="badge-grid"
        >
          <div
            v-for="badge in badges"
            :key="badge.id"
            class="badge-cell"
            :class="{ locked: !badge.earned }"
            :title="badge.description ?? undefined"
          >
            <div class="badge-medal">
              <i
                class="fas"
                :class="badge.icon ?? 'fa-award'"
                aria-hidden="true"
              />
            </div>
            <span>{{ badge.name ?? badge.code }}</span>
          </div>
        </div>
      </div>
      <p class="badge-hint">
        <i
          class="fas fa-circle-info"
          aria-hidden="true"
        />
        Lencana diraih otomatis dari aksimu — mulai aktif di pembaruan berikutnya.
      </p>
    </section>
  </main>

  <!-- ═══ SHEET UNGGAH BUKTI ═══ -->
  <div
    v-if="claimMission"
    class="sheet-scrim"
    @click.self="closeClaim"
  >
    <!-- Langkah 1: consent foto (PRD §9) — kartu reusable Sprint 3. -->
    <ConsentCard
      v-if="needConsent"
      title="Izin Foto Bukti Misi"
      description="Sebelum unggah, kami perlu izinmu memakai foto bukti misi."
      agree-label="Setuju & Lanjutkan"
      cancel-label="Nanti Saja"
      @agree="agreeConsent"
      @cancel="closeClaim"
    />
    <!-- Langkah 2: pilih foto + kirim. -->
    <div
      v-else
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="claim-sheet-title"
    >
      <div class="sheet-handle" />
      <h2
        id="claim-sheet-title"
        ref="sheetTitle"
        tabindex="-1"
      >
        Unggah Bukti
      </h2>
      <p class="sheet-mission">
        <i
          class="fas fa-bullseye"
          aria-hidden="true"
        />
        {{ claimMission.title }} · +{{ claimMission.points }} poin
      </p>
      <div
        v-if="photoUrl"
        class="proof-preview"
      >
        <img
          :src="photoUrl"
          alt="Pratinjau foto bukti misi"
        >
      </div>
      <div
        v-else
        class="proof-empty"
      >
        <i
          class="fas fa-image"
          aria-hidden="true"
        />
        <span>Belum ada foto</span>
      </div>
      <div class="proof-actions">
        <button
          class="btn btn-secondary"
          type="button"
          :disabled="submitting"
          @click="pickCamera"
        >
          <i
            class="fas fa-camera"
            aria-hidden="true"
          />
          Kamera
        </button>
        <button
          class="btn btn-secondary"
          type="button"
          :disabled="submitting"
          @click="pickGallery"
        >
          <i
            class="fas fa-image"
            aria-hidden="true"
          />
          Galeri
        </button>
      </div>
      <p class="upload-note">
        <i
          class="fas fa-circle-info"
          aria-hidden="true"
        />
        Foto mungkin memuat wajah — hanya dilihat admin verifier. Lihat Kebijakan Privasi.
      </p>
      <button
        class="btn btn-primary btn-block"
        type="button"
        :disabled="!photo || submitting"
        @click="submitClaim"
      >
        <span
          v-if="submitting"
          class="spinner dark"
          aria-hidden="true"
        />
        {{ submitting ? 'Mengirim…' : 'Kirim Bukti' }}
      </button>
      <button
        class="btn btn-ghost btn-block"
        type="button"
        :disabled="submitting"
        @click="closeClaim"
      >
        Batal
      </button>
    </div>
  </div>

  <!-- Input foto tersembunyi (kamera & galeri — tanpa plugin native) -->
  <input
    ref="cameraInput"
    type="file"
    accept="image/*"
    capture="environment"
    class="sr-only-input"
    aria-hidden="true"
    tabindex="-1"
    @change="onPhotoChange($event, cameraInput)"
  >
  <input
    ref="galleryInput"
    type="file"
    accept="image/*"
    class="sr-only-input"
    aria-hidden="true"
    tabindex="-1"
    @change="onPhotoChange($event, galleryInput)"
  >
</template>

<style scoped>
.mission-head {
  padding-bottom: 64px;
}
.mission-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.mission-top h1 {
  color: var(--color-on-dark);
  font-size: var(--text-xl);
  flex: 1;
}
.back-btn {
  min-width: 44px;
  min-height: 44px;
  border: 1px solid color-mix(in srgb, var(--color-surface) 40%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-surface) 14%, transparent);
  color: var(--color-on-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
}
.weekly {
  background: color-mix(in srgb, var(--color-surface) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-surface) 25%, transparent);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
}
.weekly .row {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-xs);
  color: var(--color-on-dark);
  margin-bottom: var(--space-2);
}
.weekly .row strong {
  color: var(--gold-light);
}
.weekly .track {
  height: 10px;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, #000 25%, transparent);
  overflow: hidden;
}
.weekly .fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  transition: width var(--dur-slow) var(--ease-out);
}

.tabs {
  margin-bottom: var(--space-4);
}

/* ── Tab Pencapaian ── */
.badge-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
}
.badge-cell {
  text-align: center;
}
.badge-medal {
  width: 56px;
  height: 56px;
  margin: 0 auto 6px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  border: 2px solid transparent;
}
.badge-cell.locked .badge-medal {
  background: var(--surface-alt);
  color: var(--ink-300);
  border-color: var(--line);
}
.badge-cell.locked span {
  opacity: 0.75;
}
.badge-cell span {
  font-size: 10px;
  color: var(--color-text-muted);
  display: block;
}
.badge-cell .sk-circle {
  width: 100%;
  height: 100%;
}
.badge-empty {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  text-align: center;
  padding: var(--space-4);
}
.badge-hint {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-top: var(--space-3);
}
.badge-hint i {
  color: var(--color-info);
  margin-top: 2px;
}

/* ── Sheet unggah bukti (pola sheet hasil scan) ── */
.sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: var(--color-scrim);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overscroll-behavior: contain;
}
.sheet {
  width: 100%;
  max-width: var(--container-m);
  background: var(--color-surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow: var(--shadow-sheet);
  padding: var(--space-4) var(--space-5) calc(var(--space-6) + env(safe-area-inset-bottom));
  animation: sheet-up var(--dur-base) var(--ease-spring);
}
@keyframes sheet-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
.sheet-handle {
  width: 44px;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--line);
  margin: 0 auto var(--space-3);
}
.sheet h2 {
  font-size: var(--text-lg);
  outline: none;
}
.sheet-mission {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin: 4px 0 var(--space-4);
}
.sheet-mission i {
  color: var(--color-primary);
}
.proof-preview {
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--color-border);
  margin-bottom: var(--space-3);
  background: var(--surface-alt);
}
.proof-preview img {
  width: 100%;
  max-height: 220px;
  object-fit: cover;
}
.proof-empty {
  height: 120px;
  border: 2px dashed var(--line-strong);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: var(--ink-400);
  margin-bottom: var(--space-3);
}
.proof-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.sheet .upload-note {
  margin-bottom: var(--space-4);
}
.sheet .btn-block + .btn-block {
  margin-top: var(--space-3);
}
.upload-note {
  display: flex;
  gap: 8px;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  background: var(--color-info-soft);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-4);
}
.upload-note i {
  color: var(--color-info);
  margin-top: 2px;
}

/* Input file tersembunyi — tetap fungsional tanpa mengganggu layout/a11y. */
.sr-only-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
