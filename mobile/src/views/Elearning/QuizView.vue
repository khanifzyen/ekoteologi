<script setup lang="ts">
/**
 * Kuis modul (Sprint 7) — mockup `elearning.html` view kuis: intro
 * ("N soal · lulus X% · hadiah +Y poin") → satu soal per layar dgn titik
 * progres → kirim semua jawaban → penilaian OTOMATIS server → layar hasil.
 * Kunci jawaban tidak pernah dikirim sebelum submit (anti curang).
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiError } from '@/api/client'
import BottomNav from '@/components/layout/BottomNav.vue'
import StateError from '@/components/state/StateError.vue'
import { fetchQuiz, submitQuiz } from '@/services/elearning'
import { useQuizResultStore } from '@/stores/quizResult'
import { useToastStore } from '@/stores/toast'
import type { QuizIntro, QuizResult } from '@/types/elearning'
import { quizDots, quizIntroLine } from '@/utils/elearning'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const quizResultStore = useQuizResultStore()

const loading = ref(true)
const error = ref('')
const quiz = ref<QuizIntro | null>(null)
const started = ref(false)
/** Index soal aktif + jawaban terpilih per question_id. */
const current = ref(0)
const answers = ref<Record<number, number>>({})
const needChoice = ref(false)
const submitting = ref(false)

const moduleId = computed(() => Number(route.params.moduleId))
const questions = computed(() => quiz.value?.questions ?? [])
const activeQuestion = computed(() => questions.value[current.value] ?? null)
const answeredCount = computed(() => Object.keys(answers.value).length)
const dots = computed(() => quizDots(questions.value.length, answeredCount.value))
const introLine = computed(() =>
  quiz.value ? quizIntroLine(quiz.value.question_count, quiz.value.pass_percent, quiz.value.points) : '',
)
const picked = computed(() =>
  activeQuestion.value ? answers.value[activeQuestion.value.id] : undefined,
)

function start() {
  started.value = true
  current.value = 0
  needChoice.value = false
}

function pick(choice: number) {
  if (!activeQuestion.value) return
  answers.value = { ...answers.value, [activeQuestion.value.id]: choice }
  needChoice.value = false
}

function next() {
  if (!activeQuestion.value) return
  if (picked.value === undefined) {
    needChoice.value = true
    return
  }
  if (current.value < questions.value.length - 1) {
    current.value += 1
    needChoice.value = false
  } else {
    void submit()
  }
}

async function submit() {
  if (!quiz.value || submitting.value) return
  submitting.value = true
  try {
    const result: QuizResult = await submitQuiz(
      moduleId.value,
      Object.entries(answers.value).map(([questionId, choice]) => ({
        question_id: Number(questionId),
        choice,
      })),
    )
    if (result.points_awarded > 0) toast.show(result.message)
    // Hasil dinyalir lewat store (router menolak payload kompleks di history
    // state); refresh di layar hasil kembali ke intro kuis — disengaja.
    quizResultStore.set(result, quiz.value.questions)
    await router.replace({
      name: 'kuis-hasil',
      params: { moduleId: String(moduleId.value) },
    })
  } catch (err) {
    toast.show(
      err instanceof ApiError ? err.message : 'Gagal mengirim jawaban. Coba lagi.',
    )
  } finally {
    submitting.value = false
  }
}

async function load() {
  error.value = ''
  loading.value = true
  try {
    quiz.value = await fetchQuiz(moduleId.value)
  } catch (err) {
    error.value =
      err instanceof ApiError
        ? err.message
        : 'Gagal memuat kuis. Periksa koneksi internetmu lalu coba lagi.'
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
        aria-label="Kembali ke modul"
        @click="router.back()"
      >
        <i
          class="fas fa-angle-left"
          aria-hidden="true"
        />
      </button>
      <h1 class="screen-title">
        Kuis
      </h1>
    </div>
  </header>

  <main class="content-overlap">
    <div
      v-if="loading"
      class="card"
      aria-hidden="true"
    >
      <div class="sk-lines quiz-skel">
        <span class="skeleton sk-circle" />
        <div class="skeleton" />
        <div
          class="skeleton"
          style="width: 70%"
        />
      </div>
    </div>

    <StateError
      v-else-if="error"
      :message="error"
      @retry="load"
    />

    <template v-else-if="quiz">
      <!-- Intro -->
      <div
        v-if="!started"
        class="card quiz-intro"
        data-testid="quiz-intro"
      >
        <div class="empty-icon">
          <i
            class="fas fa-circle-question"
            aria-hidden="true"
          />
        </div>
        <h3>Kuis: {{ quiz.question_count }} Soal</h3>
        <p
          class="intro-line"
          data-testid="quiz-intro-line"
        >
          {{ introLine }}
        </p>
        <button
          class="btn btn-primary btn-block"
          type="button"
          @click="start"
        >
          Mulai Kuis
          <i
            class="fas fa-play"
            aria-hidden="true"
          />
        </button>
      </div>

      <!-- Pengerjaan -->
      <template v-else-if="activeQuestion">
        <div
          class="quiz-progress"
          role="img"
          :aria-label="`Soal ${current + 1} dari ${questions.length}`"
        >
          <span
            v-for="(done, i) in dots"
            :key="i"
            :class="{ done }"
          />
        </div>
        <div class="card">
          <h3 class="q-text">
            {{ activeQuestion.question }}
          </h3>
          <label
            v-for="(option, oi) in activeQuestion.options"
            :key="oi"
            class="opt"
          >
            <input
              type="radio"
              :name="`q-${activeQuestion.id}`"
              :value="oi"
              :checked="picked === oi"
              @change="pick(oi)"
            >
            {{ option }}
          </label>
          <p
            v-if="needChoice"
            class="field-error need-choice"
            role="alert"
          >
            Pilih salah satu jawaban dulu, ya.
          </p>
          <button
            class="btn btn-primary btn-block"
            type="button"
            data-testid="quiz-next"
            :disabled="submitting"
            @click="next"
          >
            {{
              submitting
                ? 'Menilai…'
                : current === questions.length - 1
                  ? 'Selesai & Lihat Hasil'
                  : 'Jawab'
            }}
          </button>
        </div>
      </template>
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
.quiz-skel {
  align-items: center;
}
.quiz-intro {
  margin-top: var(--space-4);
  text-align: center;
}
.quiz-intro .empty-icon {
  margin-bottom: var(--space-3);
}
.quiz-intro h3 {
  font-size: var(--text-lg);
  margin-bottom: 4px;
}
.intro-line {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-4);
}

/* Titik progres kuis (mockup .quiz-progress) */
.quiz-progress {
  display: flex;
  gap: 6px;
  justify-content: center;
  margin: var(--space-4) 0;
}
.quiz-progress span {
  width: 24px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--line);
}
.quiz-progress span.done {
  background: var(--color-primary);
}
.q-text {
  font-size: var(--text-md);
  margin-bottom: var(--space-4);
}

/* Pilihan jawaban (mockup .opt) — tap target ≥48px */
.opt {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  border: 1.5px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-3);
  cursor: pointer;
  min-height: 48px;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
  font-size: var(--text-sm);
}
.opt input {
  accent-color: var(--color-primary);
  width: 18px;
  height: 18px;
  flex: none;
}
.opt:has(input:checked) {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  font-weight: 600;
}
.need-choice {
  display: block;
  margin-bottom: var(--space-3);
}
</style>
