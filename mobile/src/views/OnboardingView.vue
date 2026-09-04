<script setup lang="ts">
/**
 * Splash & onboarding (Sprint 1, polish final Sprint 7) — 1:1 mockup
 * `onboarding.html`. Polish final: (1) splash menunggu font siap
 * (`document.fonts.ready` dgn batas waktu — mencegah FOUT di slide berikut)
 * + durasi minimum; (2) navigasi geser (swipe) antar slide; (3) tombol
 * panah keyboard utk aksesibilitas; (4) pengumuman slide via aria-live.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useToastStore } from '@/stores/toast'

const router = useRouter()
const toast = useToastStore()

/**
 * Splash tampil minimal MIN_SPLASH_MS dan maksimal sampai font siap
 * (cap MAX_FONT_WAIT_MS — jangan pernah menggantung user; reduced-motion
 * dihormati tokens.css sehingga loader memang statis).
 */
const MIN_SPLASH_MS = 1200
const MAX_FONT_WAIT_MS = 2500
const splash = ref(true)

function hideSplash() {
  splash.value = false
}

onMounted(() => {
  const minDelay = new Promise<void>((resolve) => window.setTimeout(resolve, MIN_SPLASH_MS))
  const fontsReady: Promise<void> =
    typeof document !== 'undefined' && 'fonts' in document
      ? Promise.race([
          document.fonts.ready.then(() => undefined),
          new Promise<void>((resolve) => window.setTimeout(resolve, MAX_FONT_WAIT_MS)),
        ])
      : Promise.resolve()
  Promise.all([minDelay, fontsReady]).then(hideSplash)

  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

const slides = [
  {
    title: 'Kenali Sampah',
    titleEm: 'Sekilas',
    text: 'Arahkan kamera ke sampah — AI langsung mengenali jenisnya, memberi saran pembuangan, dan poin kebaikan.',
    main: 'fa-camera',
    sats: ['fa-recycle', 'fa-seedling', 'fa-tree', 'fa-coins'],
  },
  {
    title: 'Belajar Fiqih',
    titleEm: 'Lingkungan',
    text: 'Modul singkat + kuis interaktif. Setiap pelajaran menambah wawasan dan poinmu.',
    main: 'fa-book-open',
    sats: ['fa-graduation-cap', 'fa-circle-question', 'fa-award', 'fa-lightbulb'],
  },
  {
    title: 'Aksi Nyata,',
    titleEm: 'Pahala Nyata',
    text: 'Selesaikan misi harian, jaga streak, dan tumbuhkan pohon virtual dari kebaikanmu.',
    main: 'fa-tree',
    sats: ['fa-fire', 'fa-medal', 'fa-bullseye', 'fa-users'],
  },
]

const current = ref(0)
const isLast = computed(() => current.value === slides.length - 1)

function goTo(i: number) {
  current.value = i
}

function next() {
  if (isLast.value) finish()
  else current.value += 1
}

function prev() {
  if (current.value > 0) current.value -= 1
}

/** Swipe antar slide (≥48px horizontal — tidak mengganggu scroll vertikal). */
let touchStartX = 0
function onTouchStart(event: TouchEvent) {
  touchStartX = event.changedTouches[0]?.clientX ?? 0
}
function onTouchEnd(event: TouchEvent) {
  const deltaX = (event.changedTouches[0]?.clientX ?? 0) - touchStartX
  if (Math.abs(deltaX) < 48) return
  if (deltaX < 0) next()
  else prev()
}

/** Arrow keyboard — akselerator; tombol tetap jalan untuk screen reader. */
function onKeydown(event: KeyboardEvent) {
  if (splash.value) return
  if (event.key === 'ArrowRight') next()
  else if (event.key === 'ArrowLeft') prev()
}

function finish() {
  try {
    localStorage.setItem('ekoteologi_onboarded', '1')
  } catch {
    /* abaikan — onboarding akan tampil lagi */
  }
  router.replace({ name: 'auth' })
}

function skip() {
  finish()
  toast.show('Onboarding dilewati — selamat datang!')
}
</script>

<template>
  <!-- ═══ SPLASH ═══ -->
  <section
    v-if="splash"
    class="ob-splash"
    aria-label="Layar splash"
  >
    <div class="splash-logo">
      <i
        class="fas fa-seedling"
        aria-hidden="true"
      />
    </div>
    <h1>Ekoteologi AR</h1>
    <p>Jaga bumi, jaga iman.</p>
    <div
      class="splash-loader"
      aria-hidden="true"
    >
      <span />
    </div>
    <p class="sr-only">
      Memuat aplikasi…
    </p>
  </section>

  <!-- ═══ ONBOARDING ═══ -->
  <div
    v-else
    class="ob-flow"
    aria-label="Onboarding"
  >
    <button
      class="ob-skip"
      type="button"
      @click="skip"
    >
      Lewati
      <i
        class="fas fa-angle-right"
        aria-hidden="true"
      />
    </button>

    <div
      class="ob-body"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
    >
      <div
        :key="current"
        class="ob-slide"
        role="tabpanel"
        :aria-label="`Langkah ${current + 1} dari ${slides.length}`"
      >
        <div
          class="ob-art"
          aria-hidden="true"
        >
          <div class="ic ic-main">
            <i
              class="fas"
              :class="slides[current].main"
            />
          </div>
          <div
            v-for="(sat, i) in slides[current].sats"
            :key="sat"
            class="ic"
            :class="`ic${i + 1}`"
          >
            <i
              class="fas"
              :class="sat"
            />
          </div>
        </div>
        <h1>{{ slides[current].title }} <em>{{ slides[current].titleEm }}</em></h1>
        <p>{{ slides[current].text }}</p>
      </div>
      <!-- Pengumuman perpindahan slide utk pembaca layar (polite). -->
      <p
        class="sr-only"
        aria-live="polite"
      >
        Langkah {{ current + 1 }} dari {{ slides.length }}
      </p>
    </div>

    <div
      class="ob-dots"
      role="tablist"
      aria-label="Langkah onboarding"
    >
      <button
        v-for="(_, i) in slides"
        :key="i"
        role="tab"
        :class="{ on: i === current }"
        :aria-label="`Langkah ${i + 1}`"
        :aria-selected="i === current"
        type="button"
        @click="goTo(i)"
      />
    </div>

    <div class="ob-cta">
      <button
        class="btn btn-primary btn-block"
        type="button"
        @click="next"
      >
        {{ isLast ? 'Mulai Sekarang' : 'Lanjut' }}
        <i
          class="fas fa-arrow-right"
          aria-hidden="true"
        />
      </button>
      <div class="ob-step-links">
        <button
          class="link-btn"
          type="button"
          :style="{ visibility: current === 0 ? 'hidden' : 'visible' }"
          @click="prev"
        >
          Kembali
        </button>
      </div>
    </div>
  </div>
</template>
