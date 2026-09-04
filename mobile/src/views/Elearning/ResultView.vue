<script setup lang="ts">
/**
 * Ring hasil kuis (Sprint 7) — mockup `elearning.html` `quizDone`: ring
 * conic-gradient dgn skor, judul "MasyaAllah, Lulus!", baris poin, dan
 * tombol kembali ke modul. Hasil diteruskan QuizView lewat store memori;
 * bila kosong (refresh langsung) → kembali ke intro kuis.
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BottomNav from '@/components/layout/BottomNav.vue'
import { useQuizResultStore } from '@/stores/quizResult'
import { useToastStore } from '@/stores/toast'
import { resultPointsLine, resultRingLabel, resultTitle } from '@/utils/elearning'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const quizResultStore = useQuizResultStore()

const moduleId = computed(() => Number(route.params.moduleId))
/** Hasil kuis dari store (null bila refresh langsung → redirect intro kuis). */
const result = computed(() => quizResultStore.result)
/** Soal + teks opsi utk bedah jawaban (snapshot dari store yang sama). */
const questions = computed<Record<number, { question: string; options: string[] }>>(() => {
  const map: Record<number, { question: string; options: string[] }> = {}
  for (const q of quizResultStore.questions) {
    map[q.id] = { question: q.question, options: q.options }
  }
  return map
})

if (result.value === null) {
  void router.replace({ name: 'kuis', params: { moduleId: String(moduleId.value) } })
}

/** CSS custom property `--val` utk ring conic-gradient (kompabilitas tipe). */
function ringStyle(percent: number): Record<string, string> {
  return { '--val': String(percent) }
}

/** Teks pilihan (A/B/C…) dari soal terkait — null bila indeks tak valid. */
function optionLabel(questionId: number, index: number | null): string {
  if (index === null) return 'Tidak dijawab'
  const q = questions.value[questionId]
  const text = q?.options[index]
  if (text === undefined) return '—'
  return `${String.fromCharCode(65 + index)}. ${text}`
}

function backToModule() {
  void router.push({ name: 'modul', params: { moduleId: String(moduleId.value) } })
}

function backHome() {
  toast.show('Poinmu sudah masuk — lanjutkan belajar modul lain, ya!')
  void router.push({ name: 'belajar' })
}
</script>

<template>
  <header class="header-curved">
    <div class="el-top">
      <h1 class="screen-title el-title">
        Hasil Kuis
      </h1>
    </div>
  </header>

  <main class="content-overlap">
    <div
      v-if="result"
      class="card quiz-result"
      data-testid="quiz-result"
    >
      <div
        class="ring"
        :style="ringStyle(result.percent)"
        role="img"
        :aria-label="`Skor ${result.percent} dari 100 — ${resultTitle(result.passed)}`"
      >
        <strong>{{ result.percent }}</strong>
        <span>{{ resultRingLabel(result.passed, result.pass_percent) }}</span>
      </div>
      <h3
        class="result-title"
        :class="{ passed: result.passed }"
      >
        {{ resultTitle(result.passed) }}
      </h3>
      <p
        class="result-line"
        data-testid="result-points"
      >
        {{ resultPointsLine(result.passed, result.points_awarded, result.already_passed_before) }}
      </p>
      <p class="result-score">
        Benar {{ result.score }} dari {{ result.total }} soal.
      </p>

      <!-- Review jawaban -->
      <div
        v-if="result.review.length > 0"
        class="review"
      >
        <h4>Bedah Jawaban</h4>
        <div
          v-for="item in result.review"
          :key="item.question_id"
          class="review-item"
          :class="item.correct ? 'ok' : 'bad'"
        >
          <p class="review-q">
            <i
              class="fas"
              :class="item.correct ? 'fa-circle-check' : 'fa-circle-xmark'"
              aria-hidden="true"
            />
            {{ item.question }}
          </p>
          <p class="review-a">
            Jawabanmu: <strong>{{ optionLabel(item.question_id, item.choice) }}</strong>
            <template v-if="!item.correct">
              · Kunci: <strong>{{ optionLabel(item.question_id, item.answer) }}</strong>
            </template>
          </p>
          <p
            v-if="item.explanation"
            class="review-e"
          >
            {{ item.explanation }}
          </p>
        </div>
      </div>

      <button
        class="btn btn-primary btn-block"
        type="button"
        data-testid="back-to-module"
        @click="backToModule"
      >
        Kembali ke Modul
      </button>
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        @click="backHome"
      >
        Lihat Modul Lain
      </button>
    </div>
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
.el-title {
  color: var(--color-on-dark);
  font-size: var(--text-xl);
  flex: 1;
}

/* Ring hasil (mockup .ring — conic-gradient dgn --val) */
.quiz-result {
  margin-top: var(--space-4);
  text-align: center;
  padding: var(--space-5) var(--space-4);
}
.ring {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  margin: 0 auto var(--space-4);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: conic-gradient(var(--color-primary) calc(var(--val) * 1%), var(--line) 0);
  position: relative;
}
.ring::before {
  content: '';
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  background: var(--color-surface);
}
.ring strong {
  position: relative;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: var(--text-2xl);
  color: var(--color-primary-strong);
}
.ring span {
  position: relative;
  font-size: 10px;
  color: var(--color-text-muted);
}
.result-title {
  font-size: var(--text-xl);
  color: var(--color-danger-strong);
  margin-bottom: 4px;
}
.result-title.passed {
  color: var(--color-primary-strong);
}
.result-line {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: 4px;
}
.result-score {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-bottom: var(--space-4);
}

/* Bedah jawaban */
.review {
  text-align: left;
  border-top: 1px dashed var(--color-border-strong);
  padding-top: var(--space-3);
  margin-bottom: var(--space-4);
}
.review h4 {
  font-size: var(--text-sm);
  margin-bottom: var(--space-2);
}
.review-item {
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  background: var(--color-danger-soft);
  margin-bottom: var(--space-2);
}
.review-item.ok {
  background: var(--color-primary-soft);
}
.review-q {
  font-size: var(--text-sm);
  font-weight: 600;
  display: flex;
  gap: 6px;
  align-items: baseline;
}
.review-q i {
  color: var(--color-danger-strong);
}
.review-item.ok .review-q i {
  color: var(--color-primary);
}
.review-a,
.review-e {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-top: 2px;
}
.review-a strong {
  color: var(--color-heading);
}
</style>
