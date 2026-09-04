<script setup lang="ts">
/**
 * E-Learning (Sprint 7) — CRUD modul + editor blok pelajaran (JSONB) + bank
 * soal kuis sesuai story rencana: "Admin: CRUD modul + editor blok lesson
 * (JSONB) + bank soal". Pola form panel + tabel responsif (konsisten gaya
 * admin Sprint 4/6). Blok mengikuti mockup `elearning.html`: paragraph /
 * quote (arab + terjemah + sumber) / tip. Tulis: admin|editor; hapus: admin.
 * Hapus modul ditolak server 409 bila sudah ada progres pengguna.
 */
import { computed, onMounted, ref } from 'vue'

import { ApiError, api } from '@/api/client'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import {
  BLOCK_TYPE_LABEL,
  blocksSummary,
  emptyBlock,
  lessonError,
  optionLetter,
  questionError,
  slugPreview,
  type LessonBlock,
  type QuizQuestionDraft,
} from '@/utils/elearning'

interface AdminModule {
  id: number
  title: string
  slug: string | null
  description: string | null
  cover_url: string | null
  order: number
  is_published: boolean
  lesson_count: number
  question_count: number
}

interface AdminLesson {
  id: number
  module_id: number
  title: string | null
  order: number
  blocks: LessonBlock[]
}

interface AdminQuestion {
  id: number
  quiz_id: number
  question: string
  options: string[]
  answer: number
  explanation: string | null
  order: number
}

const auth = useAuthStore()
const toast = useToastStore()
const canWrite = computed(() => auth.user !== null && ['admin', 'editor'].includes(auth.user.role))
const canDelete = computed(() => auth.user?.role === 'admin')

const loading = ref(true)
const error = ref('')
const modules = ref<AdminModule[]>([])
const publishedCount = computed(() => modules.value.filter((m) => m.is_published).length)

async function load() {
  error.value = ''
  loading.value = true
  try {
    modules.value = await api<AdminModule[]>('/v1/admin/modules', { token: auth.token })
  } catch (err) {
    error.value =
      err instanceof ApiError
        ? err.status === 0
          ? 'Tidak dapat terhubung ke server. Periksa koneksi.'
          : err.message
        : 'Terjadi kesalahan pada server.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

// ── Form modul (create/edit) ──
const showModuleForm = ref(false)
const editingModuleId = ref<number | null>(null)
const savingModule = ref(false)
const moduleFormError = ref('')
const moduleForm = ref({ title: '', slug: '', description: '', cover_url: '', order: 0, is_published: false })

function openCreateModule() {
  editingModuleId.value = null
  moduleForm.value = { title: '', slug: '', description: '', cover_url: 'fa-leaf', order: modules.value.length + 1, is_published: false }
  moduleFormError.value = ''
  showModuleForm.value = true
}

function openEditModule(m: AdminModule) {
  editingModuleId.value = m.id
  moduleForm.value = {
    title: m.title,
    slug: m.slug ?? '',
    description: m.description ?? '',
    cover_url: m.cover_url ?? '',
    order: m.order,
    is_published: m.is_published,
  }
  moduleFormError.value = ''
  showModuleForm.value = true
}

async function submitModule() {
  if (moduleForm.value.title.trim().length === 0) {
    moduleFormError.value = 'Judul modul wajib diisi.'
    return
  }
  savingModule.value = true
  const payload = {
    title: moduleForm.value.title.trim(),
    slug: moduleForm.value.slug.trim() || null,
    description: moduleForm.value.description.trim() || null,
    cover_url: moduleForm.value.cover_url.trim() || null,
    order: moduleForm.value.order,
    is_published: moduleForm.value.is_published,
  }
  try {
    if (editingModuleId.value === null) {
      await api('/v1/admin/modules', { method: 'POST', body: payload, token: auth.token })
      toast.show('Modul dibuat — tambahkan pelajaran & soal.')
    } else {
      await api(`/v1/admin/modules/${editingModuleId.value}`, { method: 'PATCH', body: payload, token: auth.token })
      toast.show('Perubahan modul tersimpan.')
    }
    showModuleForm.value = false
    await load()
  } catch (err) {
    moduleFormError.value = err instanceof ApiError ? err.message : 'Gagal menyimpan modul.'
  } finally {
    savingModule.value = false
  }
}

async function removeModule(m: AdminModule) {
  if (!confirm(`Hapus modul "${m.title}"? Tindakan ini tercatat di audit log.`)) return
  try {
    await api(`/v1/admin/modules/${m.id}`, { method: 'DELETE', token: auth.token })
    toast.show('Modul dihapus.')
    if (manageId.value === m.id) manageId.value = null
    await load()
  } catch (err) {
    toast.show(err instanceof ApiError ? err.message : 'Gagal menghapus modul.')
  }
}

// ── Panel kelola modul terpilih (pelajaran + bank soal) ──
const manageId = ref<number | null>(null)
const manageModule = computed(() => modules.value.find((m) => m.id === manageId.value) ?? null)
const lessons = ref<AdminLesson[]>([])
const questions = ref<AdminQuestion[]>([])
const manageLoading = ref(false)
const manageError = ref('')

async function openManage(m: AdminModule) {
  manageId.value = m.id
  manageLoading.value = true
  manageError.value = ''
  lessons.value = []
  questions.value = []
  try {
    const [ls, qs] = await Promise.all([
      fetchLessons(m.id),
      api<AdminQuestion[]>(`/v1/admin/modules/${m.id}/questions`, { token: auth.token }),
    ])
    lessons.value = ls
    questions.value = qs
  } catch (err) {
    manageError.value = err instanceof ApiError ? err.message : 'Gagal memuat materi modul.'
  } finally {
    manageLoading.value = false
  }
}

async function fetchLessons(moduleId: number): Promise<AdminLesson[]> {
  return api<AdminLesson[]>(`/v1/admin/modules/${moduleId}/lessons`, { token: auth.token })
}

// ── Editor pelajaran ──
const showLessonForm = ref(false)
const editingLessonId = ref<number | null>(null)
const savingLesson = ref(false)
const lessonFormError = ref('')
const lessonTitle = ref('')
const lessonBlocks = ref<LessonBlock[]>([])

function openCreateLesson() {
  editingLessonId.value = null
  lessonTitle.value = ''
  lessonBlocks.value = [emptyBlock('paragraph')]
  lessonFormError.value = ''
  showLessonForm.value = true
}

function openEditLesson(lesson: AdminLesson) {
  editingLessonId.value = lesson.id
  lessonTitle.value = lesson.title ?? ''
  lessonBlocks.value = lesson.blocks.map((b) => ({ ...b }))
  lessonFormError.value = ''
  showLessonForm.value = true
}

function addBlock(type: LessonBlock['type']) {
  lessonBlocks.value = [...lessonBlocks.value, emptyBlock(type)]
}

function removeBlock(index: number) {
  lessonBlocks.value = lessonBlocks.value.filter((_, i) => i !== index)
}

function moveBlock(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= lessonBlocks.value.length) return
  const next = [...lessonBlocks.value]
  ;[next[index], next[target]] = [next[target], next[index]]
  lessonBlocks.value = next
}

async function submitLesson() {
  const err = lessonError(lessonTitle.value, lessonBlocks.value)
  if (err) {
    lessonFormError.value = err
    return
  }
  if (manageId.value === null) return
  savingLesson.value = true
  const payload = {
    title: lessonTitle.value.trim(),
    blocks: lessonBlocks.value,
  }
  try {
    if (editingLessonId.value === null) {
      await api(`/v1/admin/modules/${manageId.value}/lessons`, { method: 'POST', body: payload, token: auth.token })
      toast.show('Pelajaran ditambahkan.')
    } else {
      await api(`/v1/admin/lessons/${editingLessonId.value}`, { method: 'PATCH', body: payload, token: auth.token })
      toast.show('Perubahan pelajaran tersimpan.')
    }
    showLessonForm.value = false
    await reloadManage()
  } catch (e) {
    lessonFormError.value = e instanceof ApiError ? e.message : 'Gagal menyimpan pelajaran.'
  } finally {
    savingLesson.value = false
  }
}

async function removeLesson(lesson: AdminLesson) {
  if (!confirm(`Hapus pelajaran "${lesson.title ?? lesson.id}"?`)) return
  try {
    await api(`/v1/admin/lessons/${lesson.id}`, { method: 'DELETE', token: auth.token })
    toast.show('Pelajaran dihapus.')
    await reloadManage()
  } catch (err) {
    toast.show(err instanceof ApiError ? err.message : 'Gagal menghapus pelajaran.')
  }
}

// ── Editor soal ──
const showQuestionForm = ref(false)
const editingQuestionId = ref<number | null>(null)
const savingQuestion = ref(false)
const questionFormError = ref('')
const questionDraft = ref<QuizQuestionDraft>({ question: '', options: ['', '', '', ''], answer: 0, explanation: '' })

function openCreateQuestion() {
  editingQuestionId.value = null
  questionDraft.value = { question: '', options: ['', '', '', ''], answer: 0, explanation: '' }
  questionFormError.value = ''
  showQuestionForm.value = true
}

function openEditQuestion(q: AdminQuestion) {
  editingQuestionId.value = q.id
  questionDraft.value = {
    question: q.question,
    options: [...q.options, '', '', '', ''].slice(0, Math.max(4, q.options.length)),
    answer: q.answer,
    explanation: q.explanation ?? '',
  }
  questionFormError.value = ''
  showQuestionForm.value = true
}

async function submitQuestion() {
  const err = questionError(questionDraft.value)
  if (err) {
    questionFormError.value = err
    return
  }
  if (manageId.value === null) return
  savingQuestion.value = true
  const filled = questionDraft.value.options.map((o) => o.trim()).filter((o) => o.length > 0)
  const payload = {
    question: questionDraft.value.question.trim(),
    options: filled,
    answer: Math.min(questionDraft.value.answer, filled.length - 1),
    explanation: questionDraft.value.explanation.trim() || null,
  }
  try {
    if (editingQuestionId.value === null) {
      await api(`/v1/admin/modules/${manageId.value}/questions`, { method: 'POST', body: payload, token: auth.token })
      toast.show('Soal ditambahkan ke bank soal.')
    } else {
      await api(`/v1/admin/questions/${editingQuestionId.value}`, { method: 'PATCH', body: payload, token: auth.token })
      toast.show('Perubahan soal tersimpan.')
    }
    showQuestionForm.value = false
    await reloadManage()
  } catch (e) {
    questionFormError.value = e instanceof ApiError ? e.message : 'Gagal menyimpan soal.'
  } finally {
    savingQuestion.value = false
  }
}

async function removeQuestion(q: AdminQuestion) {
  if (!confirm('Hapus soal ini dari bank soal?')) return
  try {
    await api(`/v1/admin/questions/${q.id}`, { method: 'DELETE', token: auth.token })
    toast.show('Soal dihapus.')
    await reloadManage()
  } catch (err) {
    toast.show(err instanceof ApiError ? err.message : 'Gagal menghapus soal.')
  }
}

async function reloadManage() {
  await load()
  const current = modules.value.find((m) => m.id === manageId.value)
  if (current) {
    // Muat ulang daftar pelajaran & soal tanpa menutup panel.
    manageLoading.value = true
    try {
      const [ls, qs] = await Promise.all([
        fetchLessons(current.id),
        api<AdminQuestion[]>(`/v1/admin/modules/${current.id}/questions`, { token: auth.token }),
      ])
      lessons.value = ls
      questions.value = qs
    } finally {
      manageLoading.value = false
    }
  }
}
</script>

<template>
  <div class="page-head">
    <div>
      <h1>E-Learning</h1>
      <p>
        {{ modules.length }} modul · {{ publishedCount }} tayang — modul & kuis untuk aplikasi
      </p>
    </div>
    <div class="head-actions">
      <BaseButton
        variant="outline"
        @click="load"
      >
        <i
          class="fas fa-rotate-right"
          aria-hidden="true"
        />
        Segarkan
      </BaseButton>
      <BaseButton
        v-if="canWrite"
        variant="primary"
        @click="openCreateModule"
      >
        <i
          class="fas fa-plus"
          aria-hidden="true"
        />
        Modul Baru
      </BaseButton>
    </div>
  </div>

  <!-- Form modul (create/edit) -->
  <div
    v-if="showModuleForm"
    class="panel form-panel"
  >
    <div class="panel-head">
      <div>
        <h2>{{ editingModuleId === null ? 'Modul Baru' : 'Ubah Modul' }}</h2>
        <div class="sub">
          Ikon memakai nama FontAwesome (mis. <code>fa-leaf</code>) atau URL gambar
        </div>
      </div>
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        aria-label="Tutup form modul"
        @click="showModuleForm = false"
      >
        <i
          class="fas fa-xmark"
          aria-hidden="true"
        />
      </button>
    </div>
    <form
      class="panel-body form-grid"
      @submit.prevent="submitModule"
    >
      <div class="field">
        <label
          class="label"
          for="module-title"
        >Judul modul</label>
        <input
          id="module-title"
          v-model="moduleForm.title"
          class="input"
          type="text"
          maxlength="200"
          required
          placeholder="mis. Fiqih Sampah Sehari-hari"
        >
        <span
          v-if="moduleForm.slug === '' && moduleForm.title !== ''"
          class="hint"
        >Slug otomatis: {{ slugPreview(moduleForm.title) }}</span>
      </div>
      <div class="field">
        <label
          class="label"
          for="module-slug"
        >Slug (opsional)</label>
        <input
          id="module-slug"
          v-model="moduleForm.slug"
          class="input"
          type="text"
          maxlength="200"
          placeholder="otomatis dari judul"
        >
      </div>
      <div class="field span-2">
        <label
          class="label"
          for="module-desc"
        >Deskripsi</label>
        <textarea
          id="module-desc"
          v-model="moduleForm.description"
          class="input"
          rows="2"
          maxlength="2000"
          placeholder="Ringkasan materi modul"
        />
      </div>
      <div class="field">
        <label
          class="label"
          for="module-cover"
        >Ikon / cover</label>
        <input
          id="module-cover"
          v-model="moduleForm.cover_url"
          class="input"
          type="text"
          maxlength="1000"
          placeholder="fa-leaf"
        >
      </div>
      <div class="field">
        <label
          class="label"
          for="module-order"
        >Urutan</label>
        <input
          id="module-order"
          v-model.number="moduleForm.order"
          class="input"
          type="number"
          min="0"
        >
      </div>
      <label class="check span-2">
        <input
          v-model="moduleForm.is_published"
          type="checkbox"
        >
        Tayangkan modul ini di aplikasi (bisa dibuka peserta)
      </label>
      <p
        v-if="moduleFormError"
        class="field-error span-2"
        role="alert"
      >
        {{ moduleFormError }}
      </p>
      <div class="span-2 form-actions">
        <BaseButton
          variant="primary"
          type="submit"
          :disabled="savingModule"
        >
          <i
            class="fas fa-floppy-disk"
            aria-hidden="true"
          />
          {{ savingModule ? 'Menyimpan…' : 'Simpan Modul' }}
        </BaseButton>
        <BaseButton
          variant="outline"
          type="button"
          @click="showModuleForm = false"
        >
          Batal
        </BaseButton>
      </div>
    </form>
  </div>

  <!-- Loading -->
  <div
    v-if="loading"
    class="panel"
  >
    <div class="panel-body">
      <div
        v-for="n in 3"
        :key="n"
        class="sk-row"
      >
        <BaseSkeleton />
      </div>
    </div>
  </div>

  <!-- Error -->
  <div
    v-else-if="error"
    class="panel"
  >
    <div
      class="panel-body modules-error"
      role="alert"
    >
      <i
        class="fas fa-triangle-exclamation"
        aria-hidden="true"
      />
      <p>{{ error }}</p>
      <BaseButton
        variant="outline"
        @click="load"
      >
        <i
          class="fas fa-rotate-right"
          aria-hidden="true"
        />
        Coba Lagi
      </BaseButton>
    </div>
  </div>

  <!-- Tabel modul -->
  <div
    v-else
    class="panel"
  >
    <div class="panel-head">
      <div>
        <h2>Daftar Modul</h2>
        <div class="sub">
          Modul tayang muncul di layar Belajar aplikasi — urut sesuai kolom Urutan
        </div>
      </div>
    </div>
    <div
      v-if="modules.length === 0"
      class="panel-body modules-empty"
    >
      <i
        class="fas fa-book-open"
        aria-hidden="true"
      />
      <p>
        Belum ada modul. Buat modul pertama dengan tombol "Modul Baru", lalu tambahkan
        pelajaran dan soal kuisnya.
      </p>
    </div>
    <div
      v-else
      class="table-wrap"
    >
      <table class="data">
        <thead>
          <tr>
            <th>Modul</th>
            <th>Pelajaran</th>
            <th>Soal</th>
            <th>Urutan</th>
            <th>Status</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="m in modules"
            :key="m.id"
          >
            <td data-label="Modul">
              <div class="mod-cell">
                <span
                  class="mod-ico"
                  aria-hidden="true"
                ><i
                  class="fas"
                  :class="m.cover_url && !m.cover_url.startsWith('http') ? m.cover_url : 'fa-leaf'"
                /></span>
                <div>
                  <strong>{{ m.title }}</strong>
                  <span class="sub-cell">{{ m.slug }}</span>
                </div>
              </div>
            </td>
            <td data-label="Pelajaran">
              {{ m.lesson_count }}
            </td>
            <td data-label="Soal">
              {{ m.question_count }}
            </td>
            <td data-label="Urutan">
              {{ m.order }}
            </td>
            <td data-label="Status">
              <span
                class="badge"
                :class="m.is_published ? 'badge-active' : 'badge-pending'"
              >{{ m.is_published ? 'Tayang' : 'Draft' }}</span>
            </td>
            <td data-label="Aksi">
              <div class="row-actions">
                <button
                  v-if="canWrite"
                  class="btn btn-outline btn-sm"
                  type="button"
                  @click="openManage(m)"
                >
                  Kelola
                </button>
                <button
                  v-if="canWrite"
                  class="btn btn-outline btn-sm"
                  type="button"
                  @click="openEditModule(m)"
                >
                  Ubah
                </button>
                <button
                  v-if="canDelete"
                  class="btn btn-danger btn-sm"
                  type="button"
                  @click="removeModule(m)"
                >
                  Hapus
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ═══ Panel kelola modul: pelajaran + bank soal ═══ -->
  <div
    v-if="manageModule"
    class="panel manage-panel"
  >
    <div class="panel-head">
      <div>
        <h2>Kelola: {{ manageModule.title }}</h2>
        <div class="sub">
          {{ lessons.length }} pelajaran · {{ questions.length }} soal — kuis diambil dari bank soal
        </div>
      </div>
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        aria-label="Tutup panel kelola"
        @click="manageId = null"
      >
        <i
          class="fas fa-xmark"
          aria-hidden="true"
        />
      </button>
    </div>

    <div
      v-if="manageLoading"
      class="panel-body"
    >
      <div
        v-for="n in 3"
        :key="n"
        class="sk-row"
      >
        <BaseSkeleton />
      </div>
    </div>
    <div
      v-else-if="manageError"
      class="panel-body modules-error"
      role="alert"
    >
      <i
        class="fas fa-triangle-exclamation"
        aria-hidden="true"
      />
      <p>{{ manageError }}</p>
    </div>

    <div
      v-else
      class="manage-grid"
    >
      <!-- ── Pelajaran ── -->
      <section class="manage-col">
        <div class="col-head">
          <h3>
            <i
              class="fas fa-book-open"
              aria-hidden="true"
            />
            Pelajaran
          </h3>
          <BaseButton
            v-if="canWrite"
            variant="primary"
            @click="openCreateLesson"
          >
            <i
              class="fas fa-plus"
              aria-hidden="true"
            />
            Tambah
          </BaseButton>
        </div>
        <p
          v-if="lessons.length === 0"
          class="col-empty"
        >
          Belum ada pelajaran — tambahkan pelajaran pertama.
        </p>
        <ol class="lesson-list">
          <li
            v-for="lesson in lessons"
            :key="lesson.id"
            class="lesson-item"
          >
            <div class="lesson-main">
              <strong>{{ lesson.title ?? `Pelajaran ${lesson.order + 1}` }}</strong>
              <span class="sub-cell">{{ blocksSummary(lesson.blocks) }}</span>
            </div>
            <div class="row-actions">
              <button
                v-if="canWrite"
                class="btn btn-outline btn-sm"
                type="button"
                @click="openEditLesson(lesson)"
              >
                Ubah
              </button>
              <button
                v-if="canDelete"
                class="btn btn-danger btn-sm"
                type="button"
                @click="removeLesson(lesson)"
              >
                Hapus
              </button>
            </div>
          </li>
        </ol>
      </section>

      <!-- ── Bank soal ── -->
      <section class="manage-col">
        <div class="col-head">
          <h3>
            <i
              class="fas fa-circle-question"
              aria-hidden="true"
            />
            Bank Soal
          </h3>
          <BaseButton
            v-if="canWrite"
            variant="primary"
            @click="openCreateQuestion"
          >
            <i
              class="fas fa-plus"
              aria-hidden="true"
            />
            Tambah
          </BaseButton>
        </div>
        <p
          v-if="questions.length === 0"
          class="col-empty"
        >
          Belum ada soal — kuis otomatis dibuat saat soal pertama ditambahkan.
        </p>
        <ol class="lesson-list">
          <li
            v-for="(q, qi) in questions"
            :key="q.id"
            class="lesson-item"
          >
            <div class="lesson-main">
              <strong>{{ qi + 1 }}. {{ q.question }}</strong>
              <span class="sub-cell">
                Kunci: {{ optionLetter(q.answer) }} — {{ q.options[q.answer] }}
              </span>
            </div>
            <div class="row-actions">
              <button
                v-if="canWrite"
                class="btn btn-outline btn-sm"
                type="button"
                @click="openEditQuestion(q)"
              >
                Ubah
              </button>
              <button
                v-if="canDelete"
                class="btn btn-danger btn-sm"
                type="button"
                @click="removeQuestion(q)"
              >
                Hapus
              </button>
            </div>
          </li>
        </ol>
      </section>
    </div>

    <!-- Form pelajaran -->
    <div
      v-if="showLessonForm"
      class="sub-form"
    >
      <h3>{{ editingLessonId === null ? 'Tambah Pelajaran' : 'Ubah Pelajaran' }}</h3>
      <form
        class="form-grid"
        @submit.prevent="submitLesson"
      >
        <div class="field span-2">
          <label
            class="label"
            for="lesson-title"
          >Judul pelajaran</label>
          <input
            id="lesson-title"
            v-model="lessonTitle"
            class="input"
            type="text"
            maxlength="200"
            required
            placeholder="mis. Hukum Memilah Sampah dalam Islam"
          >
        </div>

        <!-- Editor blok -->
        <div class="span-2">
          <div class="col-head">
            <span class="label">Blok konten (urut dari atas)</span>
            <div class="row-actions">
              <button
                v-for="type in (['paragraph', 'quote', 'tip'] as const)"
                :key="type"
                class="btn btn-outline btn-sm"
                type="button"
                @click="addBlock(type)"
              >
                <i
                  class="fas fa-plus"
                  aria-hidden="true"
                />
                {{ BLOCK_TYPE_LABEL[type] }}
              </button>
            </div>
          </div>
          <div
            v-for="(block, bi) in lessonBlocks"
            :key="bi"
            class="block-editor"
          >
            <div class="block-head">
              <span class="badge badge-pending">{{ BLOCK_TYPE_LABEL[block.type] }}</span>
              <div class="row-actions">
                <button
                  class="btn btn-ghost btn-sm"
                  type="button"
                  aria-label="Naikkan blok"
                  :disabled="bi === 0"
                  @click="moveBlock(bi, -1)"
                >
                  <i
                    class="fas fa-arrow-up"
                    aria-hidden="true"
                  />
                </button>
                <button
                  class="btn btn-ghost btn-sm"
                  type="button"
                  aria-label="Turunkan blok"
                  :disabled="bi === lessonBlocks.length - 1"
                  @click="moveBlock(bi, 1)"
                >
                  <i
                    class="fas fa-arrow-down"
                    aria-hidden="true"
                  />
                </button>
                <button
                  class="btn btn-ghost btn-sm"
                  type="button"
                  aria-label="Hapus blok"
                  @click="removeBlock(bi)"
                >
                  <i
                    class="fas fa-trash"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
            <div
              v-if="block.type === 'quote'"
              class="field"
            >
              <label
                class="label"
                :for="`block-arabic-${bi}`"
              >Teks Arab (opsional)</label>
              <input
                :id="`block-arabic-${bi}`"
                v-model="block.arabic"
                class="input"
                type="text"
                dir="rtl"
                lang="ar"
                placeholder="النص العربي"
              >
            </div>
            <div class="field">
              <label
                class="label"
                :for="`block-text-${bi}`"
              >{{ block.type === 'quote' ? 'Terjemah / isi kutipan' : 'Teks' }}</label>
              <textarea
                :id="`block-text-${bi}`"
                v-model="block.text"
                class="input"
                rows="2"
                maxlength="5000"
                required
              />
            </div>
            <div
              v-if="block.type === 'quote'"
              class="field"
            >
              <label
                class="label"
                :for="`block-source-${bi}`"
              >Sumber (opsional)</label>
              <input
                :id="`block-source-${bi}`"
                v-model="block.source"
                class="input"
                type="text"
                maxlength="200"
                placeholder="mis. QS. Al-A'raf: 56"
              >
            </div>
          </div>
        </div>

        <p
          v-if="lessonFormError"
          class="field-error span-2"
          role="alert"
        >
          {{ lessonFormError }}
        </p>
        <div class="span-2 form-actions">
          <BaseButton
            variant="primary"
            type="submit"
            :disabled="savingLesson"
          >
            {{ savingLesson ? 'Menyimpan…' : 'Simpan Pelajaran' }}
          </BaseButton>
          <BaseButton
            variant="outline"
            type="button"
            @click="showLessonForm = false"
          >
            Batal
          </BaseButton>
        </div>
      </form>
    </div>

    <!-- Form soal -->
    <div
      v-if="showQuestionForm"
      class="sub-form"
    >
      <h3>{{ editingQuestionId === null ? 'Tambah Soal' : 'Ubah Soal' }}</h3>
      <form
        class="form-grid"
        @submit.prevent="submitQuestion"
      >
        <div class="field span-2">
          <label
            class="label"
            for="question-text"
          >Pertanyaan</label>
          <textarea
            id="question-text"
            v-model="questionDraft.question"
            class="input"
            rows="2"
            maxlength="2000"
            required
            placeholder="mis. Sampah plastik termasuk kategori…"
          />
        </div>
        <fieldset class="span-2 options-fieldset">
          <legend class="label">
            Pilihan jawaban — tandai yang benar (minimal 2 terisi)
          </legend>
          <div
            v-for="(_, oi) in questionDraft.options"
            :key="oi"
            class="option-row"
          >
            <input
              v-model="questionDraft.answer"
              type="radio"
              name="correct-answer"
              :value="oi"
              :aria-label="`Jadwal pilihan ${optionLetter(oi)} sebagai kunci jawaban`"
            >
            <span class="opt-letter">{{ optionLetter(oi) }}</span>
            <input
              v-model="questionDraft.options[oi]"
              class="input"
              type="text"
              maxlength="500"
              :aria-label="`Teks pilihan ${optionLetter(oi)}`"
            >
          </div>
        </fieldset>
        <div class="field span-2">
          <label
            class="label"
            for="question-explanation"
          >Penjelasan (tampil setelah kuis — opsional)</label>
          <textarea
            id="question-explanation"
            v-model="questionDraft.explanation"
            class="input"
            rows="2"
            maxlength="2000"
          />
        </div>
        <p
          v-if="questionFormError"
          class="field-error span-2"
          role="alert"
        >
          {{ questionFormError }}
        </p>
        <div class="span-2 form-actions">
          <BaseButton
            variant="primary"
            type="submit"
            :disabled="savingQuestion"
          >
            {{ savingQuestion ? 'Menyimpan…' : 'Simpan Soal' }}
          </BaseButton>
          <BaseButton
            variant="outline"
            type="button"
            @click="showQuestionForm = false"
          >
            Batal
          </BaseButton>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: var(--space-2);
}
.form-panel {
  margin-bottom: var(--space-4);
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 var(--space-4);
}
.form-grid .span-2 {
  grid-column: span 2;
}
.form-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.sk-row {
  padding: var(--space-2) 0;
}
.modules-error {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-danger-strong);
  flex-wrap: wrap;
}
.modules-empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: var(--space-6);
}
.modules-empty i {
  font-size: var(--text-xl);
  display: block;
  margin-bottom: var(--space-2);
}
.sub-cell {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.row-actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.mod-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.mod-ico {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--radius-sm);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  display: flex;
  align-items: center;
  justify-content: center;
}
.check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  margin-top: var(--space-2);
}
.manage-panel {
  margin-top: var(--space-4);
}
.manage-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  padding: var(--space-4);
}
.col-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.col-head h3 {
  font-size: var(--text-md);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.col-empty {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.lesson-list {
  list-style: none;
  display: grid;
  gap: var(--space-2);
}
.lesson-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
}
.lesson-main strong {
  display: block;
  font-size: var(--text-sm);
}
.sub-form {
  border-top: 1px solid var(--color-border);
  padding: var(--space-4);
}
.sub-form h3 {
  margin-bottom: var(--space-3);
  font-size: var(--text-md);
}
.block-editor {
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  margin-bottom: var(--space-3);
}
.block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-2);
}
.options-fieldset {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: grid;
  gap: var(--space-2);
}
.options-fieldset legend {
  padding: 0 var(--space-2);
}
.option-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.option-row input[type='radio'] {
  width: 18px;
  height: 18px;
  accent-color: var(--color-primary);
}
.opt-letter {
  font-weight: 700;
  width: 18px;
  text-align: center;
}
@media (max-width: 767px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-grid .span-2 {
    grid-column: span 1;
  }
  .manage-grid {
    grid-template-columns: 1fr;
  }
}
</style>
