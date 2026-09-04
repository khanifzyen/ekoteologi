<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useToastStore } from '@/stores/toast'

const router = useRouter()
const toast = useToastStore()

/** State awal splash lalu pindah sendiri ke slide onboarding (mockup onboarding.html). */
const SPLASH_MS = 1600
const splash = ref(true)
onMounted(() => {
  window.setTimeout(() => (splash.value = false), SPLASH_MS)
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

    <div class="ob-body">
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
