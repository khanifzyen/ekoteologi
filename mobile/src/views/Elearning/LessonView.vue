<script setup lang="ts">
/**
 * Detail pelajaran (Sprint 7) — 1:1 mockup `elearning.html` view pelajaran:
 * render blok konten JSONB (paragraph / quote arab+terjemah / tip), lalu
 * "Tandai Selesai & Lanjut" (progres berurutan server) dan "Lompat ke Kuis".
 * State: skeleton, error (+ Coba Lagi), lesson tidak ada → error message.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiError } from '@/api/client'
import BottomNav from '@/components/layout/BottomNav.vue'
import StateError from '@/components/state/StateError.vue'
import { completeLesson, fetchLesson } from '@/services/elearning'
import { useToastStore } from '@/stores/toast'
import type { LessonDetail } from '@/types/elearning'
import { lessonPosition } from '@/utils/elearning'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const loading = ref(true)
const error = ref('')
const lesson = ref<LessonDetail | null>(null)
const marking = ref(false)

const moduleTitle = computed(() => lesson.value?.module_title ?? '')
const position = computed(() =>
  lesson.value ? lessonPosition(lesson.value.order, lesson.value.total_lessons) : '',
)

async function load() {
  error.value = ''
  loading.value = true
  const lessonId = Number(route.params.lessonId)
  try {
    lesson.value = await fetchLesson(lessonId)
  } catch (err) {
    error.value =
      err instanceof ApiError
        ? err.message
        : 'Gagal memuat pelajaran. Periksa koneksi internetmu lalu coba lagi.'
  } finally {
    loading.value = false
  }
}

/** Tandai selesai → pelajaran berikutnya, atau kuis bila pelajaran terakhir. */
async function markDone() {
  if (!lesson.value || marking.value) return
  marking.value = true
  try {
    const result = await completeLesson(lesson.value.id)
    toast.show(result.message)
    if (result.just_completed) {
      // Modul tuntas → arahkan ke kuis (poin menunggu di sana).
      await router.replace({
        name: 'kuis',
        params: { moduleId: String(lesson.value.module_id) },
      })
      return
    }
    if (lesson.value.next_lesson_id !== null) {
      await router.replace({
        name: 'pelajaran',
        params: { lessonId: String(lesson.value.next_lesson_id) },
      })
    } else {
      await router.replace({ name: 'modul', params: { moduleId: String(lesson.value.module_id) } })
    }
  } catch (err) {
    toast.show(
      err instanceof ApiError ? err.message : 'Gagal menandai pelajaran. Coba lagi.',
    )
  } finally {
    marking.value = false
  }
}

function goQuiz() {
  if (!lesson.value) return
  void router.push({ name: 'kuis', params: { moduleId: String(lesson.value.module_id) } })
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
      <h1 class="screen-title">
        Pelajaran
      </h1>
    </div>
  </header>

  <main class="content-overlap">
    <div
      v-if="loading"
      class="card"
      aria-hidden="true"
    >
      <div class="sk-lines">
        <div
          class="skeleton"
          style="width: 55%; height: 20px"
        />
        <div class="skeleton" />
        <div class="skeleton" />
        <div
          class="skeleton"
          style="width: 80%"
        />
      </div>
    </div>

    <StateError
      v-else-if="error"
      :message="error"
      @retry="load"
    />

    <template v-else-if="lesson">
      <div class="section-head el-head">
        <h2>{{ position }}</h2>
        <span class="chip chip-green">
          <i
            class="fas fa-book-open"
            aria-hidden="true"
          />
          {{ moduleTitle }}
        </span>
      </div>

      <article class="card">
        <h3 class="lesson-title">
          {{ lesson.title }}
        </h3>

        <!-- Blok konten (JSONB) -->
        <template
          v-for="(block, i) in lesson.blocks"
          :key="i"
        >
          <div
            v-if="block.type === 'paragraph'"
            class="block block-p"
          >
            <p>{{ block.text }}</p>
          </div>
          <div
            v-else-if="block.type === 'quote'"
            class="block block-quote"
          >
            <div
              v-if="block.arabic"
              class="arabic"
              lang="ar"
            >
              {{ block.arabic }}
            </div>
            <p class="trans">
              {{ block.text }}
            </p>
            <cite v-if="block.source">— {{ block.source }}</cite>
          </div>
          <div
            v-else-if="block.type === 'tip'"
            class="block block-tip"
          >
            <i
              class="fas fa-lightbulb"
              aria-hidden="true"
            />
            <p>
              <strong>Tip:</strong> {{ block.text }}
            </p>
          </div>
        </template>

        <div class="lesson-foot">
          <button
            class="btn btn-primary btn-block"
            type="button"
            data-testid="mark-done"
            :disabled="marking"
            @click="markDone"
          >
            <i
              class="fas fa-check"
              aria-hidden="true"
            />
            {{ marking ? 'Menyimpan…' : lesson.done ? 'Sudah Selesai — Lanjut' : 'Tandai Selesai & Lanjut' }}
          </button>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            data-testid="go-quiz"
            @click="goQuiz"
          >
            Lompat ke Kuis Modul
            <i
              class="fas fa-arrow-right"
              aria-hidden="true"
            />
          </button>
        </div>
      </article>
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
.el-head {
  margin-top: var(--space-4);
}
.lesson-title {
  font-size: var(--text-lg);
  margin-bottom: var(--space-3);
}

/* ── Blok konten (mockup .block-*) ── */
.block {
  margin-bottom: var(--space-4);
}
.block-p p {
  font-size: var(--text-md);
}
.block-quote {
  background: var(--color-primary-soft);
  border-left: 4px solid var(--color-primary);
  border-radius: var(--radius-sm);
  padding: var(--space-3) var(--space-4);
}
.block-quote .arabic {
  font-family: var(--font-arabic);
  direction: rtl;
  text-align: right;
  font-size: var(--text-lg);
  color: var(--color-primary-strong);
  line-height: 1.8;
  margin-bottom: 6px;
}
.block-quote .trans {
  font-size: var(--text-sm);
  font-style: italic;
}
.block-quote cite {
  display: block;
  font-style: normal;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-top: 4px;
  font-weight: 700;
}
.block-tip {
  display: flex;
  gap: var(--space-3);
  background: color-mix(in srgb, var(--gold) 15%, var(--color-surface));
  border-radius: var(--radius-sm);
  padding: var(--space-3) var(--space-4);
}
.block-tip i {
  color: var(--color-accent-text);
  margin-top: 3px;
}
.block-tip p {
  font-size: var(--text-sm);
}
.lesson-foot {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
