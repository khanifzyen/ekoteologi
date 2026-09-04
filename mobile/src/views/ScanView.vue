<script setup lang="ts">
/**
 * Layar Scan "AR" (Sprint 3) — signature, acuan 1:1 `docs/desain/mobile/scan.html`.
 * Alur: consent foto (PRD §9) → izin kamera → preview + overlay frame (sweep)
 * → shutter (flash) → POST /v1/scan → sheet hasil (stagger) / sheet error.
 * Kuota harian ditangani dari 429 + Retry-After server (`SCAN_DAILY_LIMIT`).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError } from '@/api/client'
import ConsentCard from '@/components/scan/ConsentCard.vue'
import { CameraUnavailableError, cameraSupported, pickFromGallery, startCamera, type CameraHandle } from '@/services/camera'
import { fetchQuota, submitScan } from '@/services/scan'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import type { ScanQuota, ScanResult } from '@/types/scan'
import { describeScanError, formatLatency, quotaLabel, recordLatency, type ErrorSheetContent } from '@/utils/scan'
import { grantFotoConsent, hasFotoConsent } from '@/utils/consent'

const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

/* ── State layar ── */
type Stage = 'consent' | 'permission' | 'ready' | 'analyzing' | 'result' | 'error'
const stage = ref<Stage>('permission')
const consentDone = ref(hasFotoConsent())

const camEl = ref<HTMLVideoElement | null>(null)
const flashEl = ref<HTMLDivElement | null>(null)
const sheetEl = ref<HTMLDivElement | null>(null)
const sheetTitleEl = ref<HTMLHeadingElement | null>(null)

const cameraOn = ref(false)
const scanning = ref(true) // sweep ambient saat idle
const torchOn = ref(false)
const torchAvailable = ref(false)
const shutterDisabled = ref(false)

const permissionNote = ref('')
const galleryOnly = ref(false)

const result = ref<ScanResult | null>(null)
const errorContent = ref<ErrorSheetContent | null>(null)
const errorStatus = ref(0)
const latencyText = ref('')
const sheetOpen = ref(false)

const quota = ref<ScanQuota | null>(null)
const quotaHidden = ref(false)

let camera: CameraHandle | null = null
let activeBlob: Blob | null = null

const statusKey = computed(() => {
  if (stage.value === 'analyzing') return 'busy'
  if (stage.value === 'result') return 'found'
  if (stage.value === 'error') return 'err'
  return 'idle'
})

/* ── Siklus hidup ── */
onMounted(() => {
  if (!consentDone.value) {
    stage.value = 'consent'
  } else {
    void initCamera()
  }
})

onBeforeUnmount(() => camera?.stop())

async function onConsentAgree() {
  grantFotoConsent()
  consentDone.value = true
  await initCamera()
}

function onConsentCancel() {
  toast.show('Scan butuh persetujuan foto. Kamu bisa membukanya lagi kapan pun.')
  router.back()
}

/* ── Kamera ── */
async function initCamera() {
  stage.value = 'permission'
  permissionNote.value = ''
  if (!cameraSupported()) {
    galleryOnly.value = true
    return
  }
  try {
    camera?.stop()
    camera = await startCamera(camEl.value!)
    cameraOn.value = true
    torchAvailable.value = camera.torchSupported()
    galleryOnly.value = false
    enterReady()
    void refreshQuota()
  } catch (err) {
    cameraOn.value = false
    if (err instanceof CameraUnavailableError && err.reason === 'denied') {
      permissionNote.value =
        'Akses kamera ditolak. Aktifkan izin kamera di pengaturan perangkat, atau pilih foto dari galeri.'
    } else {
      permissionNote.value =
        'Kamera tidak dapat dijalankan di perangkat ini. Kamu tetap bisa scan lewat galeri.'
      galleryOnly.value = true
    }
  }
}

function enterReady() {
  stage.value = 'ready'
  scanning.value = true
  result.value = null
  errorContent.value = null
  latencyText.value = ''
  sheetOpen.value = false
  shutterDisabled.value = false
}

async function refreshQuota() {
  try {
    quota.value = await fetchQuota()
    quotaHidden.value = false
  } catch {
    // Redis/API tidak dapat dihubungi — pill kuota disembunyikan (degrade),
    // 429 dari server tetap menutup scan bila kuota benar-benar habis.
    quotaHidden.value = true
  }
}

/* ── Ambil & unggah foto ── */
function playFlash() {
  const el = flashEl.value
  if (!el) return
  el.classList.remove('go')
  void el.offsetWidth // paksa restart animasi
  el.classList.add('go')
}

async function onShutter() {
  if (shutterDisabled.value) return
  if (!camera) return
  shutterDisabled.value = true
  playFlash()
  try {
    const blob = await camera.capture()
    await analyze(blob, 'scan.jpg')
  } catch {
    shutterDisabled.value = false
    toast.show('Kamera belum siap. Coba sesaat lagi.')
  }
}

async function onPickGallery() {
  if (shutterDisabled.value) return
  const picked = await pickFromGallery()
  if (!picked) return
  shutterDisabled.value = true
  await analyze(picked, picked instanceof File ? picked.name : 'galeri.jpg')
}

async function analyze(blob: Blob, filename: string) {
  activeBlob = blob
  stage.value = 'analyzing'
  scanning.value = false
  sheetOpen.value = false
  const startedAt = performance.now()
  try {
    const data = await submitScan(blob, filename)
    result.value = data
    errorContent.value = null
    stage.value = 'result'
    const ms = Math.round(performance.now() - startedAt)
    latencyText.value = `Analisis dalam ${formatLatency(ms)}${data.cached ? ' · dari cache' : ''}`
    recordLatency({ ms, cached: data.cached, at: new Date().toISOString() })
    auth.applyPoints(data.points_total)
    void refreshQuota()
    await openSheet()
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0
    const detail = err instanceof ApiError ? err.message : ''
    const retryAfter = err instanceof ApiError ? (err.retryAfterSeconds ?? 0) : 0
    errorStatus.value = status
    errorContent.value = describeScanError(status, detail, retryAfter)
    result.value = null
    stage.value = 'error'
    await openSheet()
  } finally {
    shutterDisabled.value = false
  }
}

async function openSheet() {
  await nextTick()
  sheetOpen.value = true
  sheetEl.value?.scrollTo({ top: 0 })
  sheetTitleEl.value?.focus({ preventScroll: true })
}

function closeSheet() {
  sheetOpen.value = false
}

/* ── Aksi sheet ── */
async function onClaimed() {
  const data = result.value
  if (data && data.points > 0) {
    toast.show(`MasyaAllah! +${data.points} poin masuk.`)
  } else if (data) {
    toast.show('Scan tercatat di riwayat — foto sama tidak diberi poin dua kali.')
  }
  await resetScan()
}

async function onRetry() {
  if (errorStatus.value === 429) {
    // Kuota habis — menunggu lalu mengunggah ulang hanya akan gagal lagi;
    // kembalikan ke kamera agar kuota besok langsung terpakai.
    await resetScan()
    return
  }
  if (activeBlob) {
    // Foto masih ada → ulangi unggahan tanpa jepret ulang.
    await analyze(activeBlob, 'scan.jpg')
    return
  }
  await resetScan()
}

async function resetScan() {
  activeBlob = null
  closeSheet()
  await nextTick()
  if (cameraOn.value && camera) {
    enterReady()
    void refreshQuota()
  } else {
    stage.value = 'permission'
    permissionNote.value = ''
  }
}

async function toggleTorch() {
  if (!camera) return
  const on = await camera.setTorch(!torchOn.value)
  torchOn.value = on ? !torchOn.value : torchOn.value
  if (!on) toast.show('Lampu kilat tidak didukung perangkat ini.')
}

function goHistory() {
  void router.push({ name: 'riwayat' })
}

function goHome() {
  void router.push({ name: 'home' })
}
</script>

<template>
  <div
    class="scan-screen"
    :class="{ analyzing: stage === 'analyzing', scanning }"
  >
    <!-- ── Viewport kamera ── -->
    <div
      class="cam"
      :class="{ 'camera-off': !cameraOn }"
      aria-hidden="true"
    >
      <video
        v-show="cameraOn"
        ref="camEl"
        class="cam-video"
        muted
        playsinline
      />
      <div class="cam-scrim" />
    </div>
    <div
      ref="flashEl"
      class="flash"
      aria-hidden="true"
    />

    <!-- ── Top bar ── -->
    <div class="cam-top">
      <button
        class="icon-btn"
        type="button"
        aria-label="Tutup pemindai"
        @click="goHome"
      >
        <i
          class="fas fa-xmark"
          aria-hidden="true"
        />
      </button>
      <span class="title"><i
        class="fas fa-wand-magic-sparkles"
        aria-hidden="true"
      /> Mode Scan AR</span>
      <div class="top-actions">
        <button
          v-if="torchAvailable && cameraOn"
          class="icon-btn"
          :class="{ on: torchOn }"
          type="button"
          :aria-pressed="torchOn"
          aria-label="Lampu kilat"
          @click="toggleTorch"
        >
          <i
            class="fas fa-bolt"
            aria-hidden="true"
          />
        </button>
        <button
          class="icon-btn"
          type="button"
          aria-label="Pilih dari galeri"
          @click="onPickGallery"
        >
          <i
            class="fas fa-images"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>

    <!-- ── Stage: frame + status ── -->
    <div class="scan-stage">
      <div class="scan-frame-wrap">
        <div
          class="scan-frame"
          :class="{ found: stage === 'result' }"
          role="img"
          aria-label="Bingkai pemindai objek"
        >
          <div
            class="grid"
            aria-hidden="true"
          />
          <div class="corner tl" />
          <div class="corner tr" />
          <div class="corner bl" />
          <div class="corner br" />
          <div
            class="sweep"
            aria-hidden="true"
          />
        </div>
      </div>
      <div
        class="scan-status"
        :class="{ found: stage === 'result', err: stage === 'error' }"
        role="status"
        aria-live="polite"
      >
        <template v-if="statusKey === 'busy'">
          <span
            class="spin"
            aria-hidden="true"
          /> Menganalisis objek…
        </template>
        <template v-else-if="statusKey === 'found'">
          <i
            class="fas fa-circle-check"
            aria-hidden="true"
          /> Objek terdeteksi!
        </template>
        <template v-else-if="statusKey === 'err'">
          <i
            class="fas fa-triangle-exclamation"
            aria-hidden="true"
          /> Scan belum berhasil
        </template>
        <template v-else>
          <i
            class="fas fa-camera"
            aria-hidden="true"
          /> Arahkan kamera ke objek sampah
        </template>
      </div>
      <p
        v-if="!quotaHidden && quotaLabel(quota)"
        class="scan-quota"
      >
        <i
          class="fas fa-ticket"
          aria-hidden="true"
        />
        {{ quotaLabel(quota) }}
      </p>
    </div>

    <!-- ── Bottom: shutter ── -->
    <div class="cam-bottom">
      <button
        class="side"
        type="button"
        :disabled="stage === 'analyzing'"
        @click="onPickGallery"
      >
        <i
          class="fas fa-images"
          aria-hidden="true"
        />Album
      </button>
      <button
        class="shutter"
        type="button"
        :disabled="shutterDisabled || stage === 'analyzing' || !cameraOn"
        aria-label="Ambil gambar untuk dipindai"
        @click="onShutter"
      >
        <span class="shutter-inner" />
      </button>
      <button
        class="side"
        type="button"
        @click="goHistory"
      >
        <i
          class="fas fa-clock-rotate-left"
          aria-hidden="true"
        />Riwayat
      </button>
    </div>

    <!-- ── Consent foto (PRD §9) ── -->
    <ConsentCard
      v-if="stage === 'consent'"
      agree-label="Setuju & Mulai Scan"
      cancel-label="Kembali"
      @agree="onConsentAgree"
      @cancel="onConsentCancel"
    />

    <!-- ── Izin kamera ── -->
    <div
      v-if="stage === 'permission' && consentDone"
      class="permission"
    >
      <div
        class="perm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permTitle"
      >
        <div class="perm-icon">
          <i
            class="fas fa-camera"
            aria-hidden="true"
          />
        </div>
        <h2 id="permTitle">
          Izinkan Akses Kamera
        </h2>
        <p>
          Aplikasi butuh akses kamera untuk mengenali jenis sampah lewat foto. Foto hanya
          diproses untuk analisis, bukan dibagikan.
        </p>
        <p
          v-if="permissionNote"
          class="perm-note"
          role="alert"
        >
          {{ permissionNote }}
        </p>
        <button
          v-if="!galleryOnly"
          class="btn btn-primary"
          type="button"
          @click="initCamera"
        >
          <i
            class="fas fa-camera"
            aria-hidden="true"
          /> Izinkan Kamera
        </button>
        <button
          class="btn"
          :class="galleryOnly ? 'btn-primary' : 'btn-secondary'"
          type="button"
          @click="onPickGallery"
        >
          <i
            class="fas fa-images"
            aria-hidden="true"
          /> Pilih dari Galeri
        </button>
      </div>
    </div>

    <!-- ══ SHEET HASIL ══ -->
    <div
      ref="sheetEl"
      class="sheet"
      :class="{ open: sheetOpen }"
      role="dialog"
      aria-labelledby="sheetTitle"
    >
      <div
        class="drag-handle"
        aria-hidden="true"
      />

      <!-- Konten hasil -->
      <div v-if="result">
        <div class="sheet-head stag">
          <div>
            <h2
              id="sheetTitle"
              ref="sheetTitleEl"
              tabindex="-1"
            >
              {{ result.item_name }}
            </h2>
            <div class="tags">
              <span
                class="tag"
                :class="`tag-cat-${(result.category?.name ?? 'lainnya').toLowerCase()}`"
              >{{ (result.category?.name ?? 'Lainnya').toUpperCase() }}</span>
              <span
                class="tag tag-gold"
              >{{ result.points > 0 ? `+${result.points} POIN` : 'POIN 0' }}</span>
            </div>
          </div>
          <div
            class="result-icon"
            aria-hidden="true"
          >
            <i class="fas fa-recycle" />
          </div>
        </div>

        <p
          v-if="result.duplicate"
          class="dup-note stag"
          role="status"
        >
          <i
            class="fas fa-clone"
            aria-hidden="true"
          />
          Foto sama dengan scan hari ini — poin tidak bertambah.
        </p>

        <div class="sheet-section stag">
          <span class="lbl">Saran Pembuangan</span>
          <p>{{ result.advice }}</p>
        </div>

        <div class="quote stag">
          <p class="trans">
            “{{ result.quote.text }}”
          </p>
          <cite>— {{ result.quote.source }}</cite>
        </div>

        <p class="sheet-foot stag">
          {{ latencyText }}
        </p>

        <div class="sheet-actions stag">
          <button
            class="btn btn-primary"
            type="button"
            @click="onClaimed"
          >
            <i
              class="fas fa-check-circle"
              aria-hidden="true"
            />
            {{ result.points > 0 ? `Saya Sudah Pilah (+${result.points} Poin)` : 'Saya Sudah Pilah' }}
          </button>
          <div class="row2">
            <button
              class="btn btn-secondary"
              type="button"
              @click="goHistory"
            >
              <i
                class="fas fa-clock-rotate-left"
                aria-hidden="true"
              /> Riwayat
            </button>
            <button
              class="btn btn-secondary"
              type="button"
              @click="resetScan"
            >
              <i
                class="fas fa-rotate-right"
                aria-hidden="true"
              /> Scan Lagi
            </button>
          </div>
        </div>
      </div>

      <!-- Konten error -->
      <div v-else-if="errorContent">
        <div class="err-card">
          <i
            class="fas fa-triangle-exclamation"
            aria-hidden="true"
          />
          <h2
            id="sheetTitle"
            ref="sheetTitleEl"
            tabindex="-1"
          >
            {{ errorContent.title }}
          </h2>
          <p>{{ errorContent.message }}</p>
          <ul v-if="errorContent.tips.length">
            <li
              v-for="tip in errorContent.tips"
              :key="tip"
            >
              {{ tip }}
            </li>
          </ul>
          <button
            class="btn btn-primary"
            type="button"
            @click="onRetry"
          >
            <i
              class="fas fa-rotate-right"
              aria-hidden="true"
            /> Coba Lagi
          </button>
          <div class="gap" />
          <button
            class="btn btn-secondary"
            type="button"
            @click="onPickGallery"
          >
            <i
              class="fas fa-images"
              aria-hidden="true"
            /> Pilih dari Galeri
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ============================================================
   LAYAR SCAN "AR" — dipindai 1:1 dari mockup scan.html (D2).
   Semua nilai memakai token — nol hardcode warna/jarak.
   ============================================================ */
.scan-screen {
  position: relative;
  flex: 1;
  overflow: clip;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
}

/* Viewport kamera */
.cam {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 70% 20%, color-mix(in srgb, var(--gold) 40%, transparent), transparent 55%),
    radial-gradient(circle at 20% 80%, var(--primary-green-soft), transparent 50%),
    linear-gradient(160deg, var(--primary-green-strong), var(--primary-green-deep));
}
.cam-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--dur-base) var(--ease-out);
}
.scan-screen.analyzing .cam-video {
  transform: scale(1.04);
}
.cam-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ink-900) 55%, transparent) 0%,
    transparent 22%,
    transparent 45%,
    color-mix(in srgb, var(--ink-900) 60%, transparent) 100%
  );
  pointer-events: none;
}

/* Top bar */
.cam-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4);
  padding-top: calc(var(--tap-target) + env(safe-area-inset-top)); /* ruang status bar (mockup: 44px) */
  z-index: 10;
}
.cam-top .title {
  color: var(--color-on-dark);
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: var(--text-sm);
  display: flex;
  align-items: center;
  gap: 6px;
}
.top-actions {
  display: flex;
  gap: var(--space-2);
}
.icon-btn {
  min-width: 44px;
  min-height: 44px;
  border: 1px solid color-mix(in srgb, var(--color-surface) 40%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--ink-900) 35%, transparent);
  color: var(--color-on-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
.icon-btn:active {
  transform: scale(0.92);
}
.icon-btn.on {
  background: var(--color-accent);
  color: var(--color-accent-fg);
  border-color: var(--color-accent);
}

/* Frame scan */
.scan-stage {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 5;
  pointer-events: none;
}
.scan-frame-wrap {
  margin-top: 17dvh;
}
.scan-frame {
  width: min(64vw, 250px);
  aspect-ratio: 1;
  border-radius: var(--radius-lg);
  border: 1.5px dashed color-mix(in srgb, var(--color-surface) 80%, transparent);
  position: relative;
  overflow: hidden;
  transition: border-color var(--dur-base) var(--ease-out);
}
.scan-frame .grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(to right, color-mix(in srgb, var(--color-surface) 22%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--color-surface) 22%, transparent) 1px, transparent 1px);
  background-size: 33.4% 33.4%;
  pointer-events: none;
}
.corner {
  position: absolute;
  width: 26px;
  height: 26px;
  border: 3px solid var(--color-accent);
  transition: border-color var(--dur-base) var(--ease-out);
}
.corner.tl { top: -2px; left: -2px; border-width: 3px 0 0 3px; border-radius: 10px 0 0 0; }
.corner.tr { top: -2px; right: -2px; border-width: 3px 3px 0 0; border-radius: 0 10px 0 0; }
.corner.bl { bottom: -2px; left: -2px; border-width: 0 0 3px 3px; border-radius: 0 0 0 10px; }
.corner.br { bottom: -2px; right: -2px; border-width: 0 3px 3px 0; border-radius: 0 0 10px 0; }
.scan-frame.found { border-color: color-mix(in srgb, var(--color-surface) 95%, transparent); }
.scan-frame.found .corner { border-color: var(--color-primary); }
.sweep {
  position: absolute;
  left: 6%;
  right: 6%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--gold-light), transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--gold) 70%, transparent);
  animation: sweep 2.2s var(--ease-out) infinite;
  opacity: 0;
}
.scan-screen.scanning .sweep {
  opacity: 1;
}
@keyframes sweep {
  0%, 100% { top: 8%; }
  50% { top: 90%; }
}

/* Status pill + kuota */
.scan-status {
  margin-top: var(--space-4);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: color-mix(in srgb, var(--ink-900) 45%, transparent);
  color: var(--color-on-dark);
  font-size: var(--text-sm);
  font-weight: 600;
  padding: 8px 16px;
  border-radius: var(--radius-pill);
  backdrop-filter: blur(4px);
  transition: background var(--dur-base) var(--ease-out);
}
.scan-status.found { background: var(--color-primary); }
.scan-status.err { background: var(--color-danger); }
.scan-quota {
  margin-top: var(--space-3);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: color-mix(in srgb, var(--ink-900) 35%, transparent);
  color: color-mix(in srgb, var(--color-on-dark) 90%, transparent);
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  backdrop-filter: blur(4px);
}
.scan-quota i {
  color: var(--gold-light);
}
.spin {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--color-surface) 35%, transparent);
  border-top-color: var(--color-surface);
  border-radius: 50%;
  animation: rot 0.7s linear infinite;
}
@keyframes rot {
  to { transform: rotate(360deg); }
}

/* Shutter & bottom controls */
.cam-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: var(--space-5) var(--space-6) calc(var(--space-6) + env(safe-area-inset-bottom));
  z-index: 10;
}
.cam-bottom .side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--color-on-dark);
  font-size: 10px;
  background: none;
  border: none;
  cursor: pointer;
  min-width: 44px;
  min-height: 48px;
}
.cam-bottom .side:disabled {
  opacity: 0.5;
}
.cam-bottom .side i {
  font-size: 20px;
}
.shutter {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-surface) 25%, transparent);
  border: 4px solid var(--color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out), opacity var(--dur-fast);
}
.shutter-inner {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: var(--color-surface);
  transition: background var(--dur-fast);
}
.shutter:active {
  transform: scale(0.9);
}
.shutter[disabled] {
  opacity: 0.55;
  cursor: wait;
  transform: scale(0.9);
}
.shutter[disabled] .shutter-inner {
  background: color-mix(in srgb, var(--color-surface) 60%, transparent);
}

/* Flash */
.flash {
  position: absolute;
  inset: 0;
  background: var(--color-surface);
  opacity: 0;
  pointer-events: none;
  z-index: 15;
}
.flash.go {
  animation: flash 180ms var(--ease-out);
}
@keyframes flash {
  0% { opacity: 0; }
  35% { opacity: 0.85; }
  100% { opacity: 0; }
}

/* Permission overlay */
.permission {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: color-mix(in srgb, var(--ink-900) 70%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  overscroll-behavior: contain;
}
.perm-card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-2);
  padding: var(--space-6) var(--space-5);
  text-align: center;
  max-width: 320px;
  width: 100%;
}
.perm-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto var(--space-4);
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.perm-card h2 {
  font-family: var(--font-heading);
  font-size: var(--text-lg);
  color: var(--color-heading);
  margin-bottom: 6px;
}
.perm-card p {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-4);
}
.perm-note {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  font-weight: 600;
}
.perm-card .btn + .btn {
  margin-top: var(--space-3);
}
.perm-card .btn {
  width: 100%;
}

/* Bottom sheet hasil */
.sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  background: var(--color-surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow: var(--shadow-sheet);
  padding: var(--space-2) var(--space-5) calc(var(--space-5) + env(safe-area-inset-bottom));
  max-height: 62dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
  transform: translateY(105%);
  transition: transform 320ms var(--ease-spring);
}
.sheet.open {
  transform: translateY(0);
}
.drag-handle {
  width: 40px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--line);
  margin: 0 auto var(--space-3);
}
.sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-3);
}
.sheet-head h2 {
  font-family: var(--font-heading);
  font-size: var(--text-xl);
  color: var(--color-text);
  outline: none;
}
.tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.tag {
  font-size: var(--text-xs);
  font-weight: 700;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
}
.tag-gold {
  background: color-mix(in srgb, var(--gold) 22%, var(--color-surface));
  color: var(--color-accent-text);
}
/* Warna kategori dari token kategori (§4 tokens.css) */
.tag-cat-organik { background: var(--cat-organik-soft); color: var(--cat-organik); }
.tag-cat-plastik { background: var(--cat-plastik-soft); color: var(--cat-plastik); }
.tag-cat-kertas { background: var(--cat-residu-soft); color: var(--cat-residu); }
.tag-cat-kaca { background: var(--cat-plastik-soft); color: var(--cat-plastik); }
.tag-cat-logam { background: var(--surface-alt); color: var(--color-text); }
.tag-cat-b3 { background: var(--cat-b3-soft); color: var(--cat-b3); }
.tag-cat-residu { background: var(--cat-residu-soft); color: var(--cat-residu); }
.tag-cat-lainnya { background: var(--color-primary-soft); color: var(--color-primary-strong); }
.result-icon {
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
.dup-note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  background: var(--color-info-soft);
  color: var(--color-info);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs);
  font-weight: 600;
  margin-top: var(--space-3);
}
.sheet-section {
  background: var(--surface-alt);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  margin-top: var(--space-4);
}
.sheet-section .lbl {
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--color-text-muted);
  font-weight: 700;
  display: block;
  margin-bottom: 6px;
}
.sheet-section p {
  font-size: var(--text-sm);
}
.quote {
  background: var(--color-primary-soft);
  border-left: 4px solid var(--color-primary);
  border-radius: var(--radius-sm);
  padding: var(--space-3) var(--space-4);
  margin-top: var(--space-4);
}
.quote .trans {
  font-size: var(--text-sm);
  font-style: italic;
}
.quote cite {
  display: block;
  font-style: normal;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-top: 4px;
  font-weight: 700;
}
.sheet-foot {
  margin-top: var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.sheet-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.sheet-actions .row2 {
  display: flex;
  gap: var(--space-3);
}
.sheet-actions .row2 .btn {
  flex: 1;
}
.sheet-actions .btn {
  width: 100%;
}
.sheet-actions .row2 .btn {
  width: auto;
}

/* Error card */
.err-card {
  text-align: center;
  padding: var(--space-4) 0 var(--space-2);
}
.err-card > i {
  font-size: 40px;
  color: var(--color-danger);
  margin-bottom: var(--space-3);
  display: block;
}
.err-card h2 {
  font-size: var(--text-lg);
  color: var(--color-danger-strong);
  margin-bottom: 6px;
  outline: none;
}
.err-card p {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-4);
}
.err-card ul {
  text-align: left;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin: 0 0 var(--space-4) var(--space-5);
}
.err-card .btn {
  width: 100%;
}
.gap {
  height: var(--space-3);
}

/* Stagger anak sheet */
.sheet .stag {
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 260ms var(--ease-out), transform 260ms var(--ease-out);
}
.sheet.open .stag {
  opacity: 1;
  transform: none;
}
.sheet.open .stag:nth-child(2) { transition-delay: 50ms; }
.sheet.open .stag:nth-child(3) { transition-delay: 100ms; }
.sheet.open .stag:nth-child(4) { transition-delay: 150ms; }
.sheet.open .stag:nth-child(5) { transition-delay: 200ms; }
.sheet.open .stag:nth-child(6) { transition-delay: 250ms; }
</style>
