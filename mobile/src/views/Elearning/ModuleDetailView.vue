<script setup lang="ts">
/**
 * Detail modul (Sprint 7) — daftar pelajaran modul + kartu kuis (intro
 * singkat: jumlah soal, ambang lulus, hadiah poin, hasil terbaik saya).
 * Pintu masuk kartu modul di daftar; CTA kartu mengikuti progres server
 * (Mulai/Lanjutkan/Ulangi). State lengkap: skeleton, error (+ Coba Lagi).
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiError } from '@/api/client'
import BottomNav from '@/components/layout/BottomNav.vue'
import StateEmpty from '@/components/state/StateEmpty.vue'
import StateError from '@/components/state/StateError.vue'
import { fetchModule } from '@/services/elearning'
import type { ModuleDetail } from '@/types/elearning'
import { modulePercent } from '@/utils/elearning'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const error = ref('')
const detail = ref<ModuleDetail | null>(null)

const moduleId = computed(() => Number(route.params.moduleId))
const nextLessonId = computed(
  () => detail.value?.lessons.find((l) => !l.done)?.id ?? detail.value?.lessons[0]?.id ?? null,
)
const allDone = computed(() => {
  const d = detail.value
  return d !== null && d.lessons.length > 0 && d.lessons.every((l) => l.done)
})
const cta = computed(() => {
  if (!detail.value || detail.value.lessons.length === 0) return 'Mulai'
  return allDone.value ? 'Ulangi' : modulePercent(detail.value) > 0 ? 'Lanjutkan' : 'Mulai'
})

function openLesson(lessonId: number) {
  void router.push({ name: 'pelajaran', params: { lessonId: String(lessonId) } })
}

function openQuiz() {
  void router.push({ name: 'kuis', params: { moduleId: String(moduleId.value) } })
}

async function load() {
  error.value = ''
  loading.value = true
  try {
    detail.value = await fetchModule(moduleId.value)
  } catch (err) {
    error.value =
      err instanceof ApiError
        ? err.message
        : 'Gagal memuat modul. Periksa koneksi internetmu lalu coba lagi.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <header class="header-curved">
    <div class="el-top">
      <button
        class="back-btn"
        type="button"
        aria-label="Kembali ke daftar modul"
        @click="router.back()"
      >
        <i
          class="fas fa-angle-left"
          aria-hidden="true"
        />
      </button>
      <h1 class="screen-title title-ellipsis">
        {{ detail?.title ?? 'Modul' }}
      </h1>
    </div>
  </header>

  <main class="content-overlap">
    <div
      v-if="loading"
      aria-hidden="true"
    >
      <div
        v-for="n in 3"
        :key="n"
        class="card sk-lesson"
      >
        <div class="sk-lines">
          <div
            class="skeleton"
            style="width: 65%"
          />
          <div
            class="skeleton"
            style="width: 40%"
          />
        </div>
      </div>
    </div>

    <StateError
      v-else-if="error"
      :message="error"
      @retry="load"
    />

    <div
      v-else-if="!detail || detail.lessons.length === 0"
      class="card"
    >
      <StateEmpty
        icon="fa-book-open"
        title="Belum ada pelajaran"
        text="Modul ini belum memiliki pelajaran. Cek lagi nanti, ya."
      />
    </div>

    <template v-else>
      <!-- Ringkasan progres + CTA utama -->
      <div class="card summary-card">
        <p class="summary-desc">
          {{ detail.description }}
        </p>
        <div
          class="pbar"
          role="progressbar"
          :aria-valuenow="modulePercent(detail)"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="Progres modul"
        >
          <div
            class="pbar-fill green"
            :style="{ width: `${modulePercent(detail)}%` }"
          />
        </div>
        <div class="summary-foot">
          <span class="summary-count">
            {{ detail.progress.lessons_done }}/{{ detail.progress.total_lessons }} pelajaran
          </span>
          <button
            class="btn btn-primary btn-sm"
            type="button"
            data-testid="summary-cta"
            @click="nextLessonId !== null && openLesson(nextLessonId)"
          >
            {{ cta }}
          </button>
        </div>
      </div>

      <div class="section-head">
        <h2>Pelajaran</h2>
      </div>

      <!-- Daftar pelajaran -->
      <button
        v-for="lesson in detail.lessons"
        :key="lesson.id"
        class="card lesson-row"
        type="button"
        :data-testid="`lesson-row-${lesson.order}`"
        @click="openLesson(lesson.id)"
      >
        <span
          class="lesson-num"
          :class="{ done: lesson.done }"
          aria-hidden="true"
        >
          <i
            :class="lesson.done ? 'fas fa-check' : 'fas fa-book-open'"
          />
        </span>
        <span class="lesson-info">
          <strong>{{ lesson.title ?? `Pelajaran ${lesson.order + 1}` }}</strong>
          <span>{{ lesson.block_count }} bagian</span>
        </span>
        <i
          class="fas fa-angle-right lesson-chevron"
          aria-hidden="true"
        />
      </button>

      <!-- Kartu kuis -->
      <div
        v-if="detail.quiz"
        class="card quiz-card"
      >
        <div class="quiz-head">
          <span
            class="quiz-icon"
            aria-hidden="true"
          >
            <i class="fas fa-circle-question" />
          </span>
          <div class="quiz-info">
            <strong>Kuis Modul</strong>
            <span data-testid="quiz-meta">
              {{ detail.quiz.question_count }} soal · lulus {{ detail.quiz.pass_percent }}% ·
              hadiah +{{ detail.quiz.points }} poin
            </span>
            <span
              v-if="detail.quiz_best"
              class="quiz-best"
              :class="{ passed: detail.quiz_best.passed }"
            >
              <i
                class="fas"
                :class="detail.quiz_best.passed ? 'fa-circle-check' : 'fa-rotate-right'"
                aria-hidden="true"
              />
              Hasil terbaik: {{ detail.quiz_best.score }}/{{ detail.quiz_best.total }}
              ({{ detail.quiz_best.percent }}%)
            </span>
          </div>
        </div>
        <button
          class="btn btn-gold btn-block"
          type="button"
          data-testid="open-quiz"
          @click="openQuiz"
        >
          {{ allDone ? 'Kerjakan Kuis' : 'Lompat ke Kuis' }}
          <i
            class="fas fa-arrow-right"
            aria-hidden="true"
          />
        </button>
      </div>
      <div
        v-else
        class="card quiz-card quiz-empty"
      >
        <i
          class="fas fa-circle-info"
          aria-hidden="true"
        />
        <p>Kuis modul ini sedang disiapkan tim editor.</p>
      </div>
    </template>
  </main>

  <BottomNav active="belajar" />
</template>

<style scoped>
.el-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}
.el-top h1 {
  color: var(--color-on-dark);
  font-size: var(--text-xl);
  flex: 1;
}
.title-ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.sk-lesson {
  margin-bottom: var(--space-3);
}
.sk-lines {
  display: grid;
  gap: 8px;
}

/* Ringkasan */
.summary-card {
  margin-top: var(--space-4);
}
.summary-desc {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-3);
}
.summary-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--space-2);
}
.summary-count {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  font-weight: 700;
}

/* Baris pelajaran (seluruh area tap — ≥64px tinggi) */
.lesson-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
  cursor: pointer;
  text-align: left;
  width: 100%;
  border: none;
  font-family: var(--font-body);
}
.lesson-num {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}
.lesson-num.done {
  background: var(--color-primary);
  color: var(--color-primary-fg);
}
.lesson-info {
  flex: 1;
  min-width: 0;
}
.lesson-info strong {
  display: block;
  font-size: var(--text-sm);
  color: var(--color-heading);
}
.lesson-info span {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.lesson-chevron {
  color: var(--color-text-muted);
  flex: none;
}

/* Kartu kuis */
.quiz-card {
  margin-top: var(--space-4);
}
.quiz-head {
  display: flex;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.quiz-icon {
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--gold) 20%, var(--color-surface));
  color: var(--color-accent-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.quiz-info strong {
  display: block;
  font-size: var(--text-sm);
}
.quiz-info span {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.quiz-best {
  margin-top: 2px;
  font-weight: 700;
}
.quiz-best.passed {
  color: var(--color-primary-strong);
}
.quiz-empty {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
</style>
