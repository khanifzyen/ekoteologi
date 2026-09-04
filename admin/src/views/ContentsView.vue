<script setup lang="ts">
/**
 * Konten Harian (Sprint 6) — CRUD `daily_contents` (PRD §5.6) sesuai story
 * rencana: "Konten harian: CRUD + penjadwalan (admin)". Penjadwalan MVP =
 * `publish_date` (tanggal tayang; satu konten per hari — UNIQUE): konten
 * bertanggal hari ini tampil di kartu "Kutipan Hari Ini" beranda aplikasi;
 * hari tanpa jadwal otomatis menampilkan kutipan bank terkurasi (server).
 * Pola form panel + tabel responsif (konsisten gaya admin). Tulis:
 * admin|editor; hapus: admin.
 */
import { computed, onMounted, ref } from 'vue'

import { ApiError, api } from '@/api/client'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

interface AdminContent {
  id: number
  publish_date: string
  type: string
  title: string | null
  body: string
  source: string | null
  eco_action: string | null
  image_url: string | null
  is_published: boolean
}

const auth = useAuthStore()
const toast = useToastStore()
const canWrite = computed(
  () => auth.user !== null && ['admin', 'editor'].includes(auth.user.role),
)
const canDelete = computed(() => auth.user?.role === 'admin')

const loading = ref(true)
const error = ref('')
const items = ref<AdminContent[]>([])

const TYPE_LABEL: Record<string, string> = {
  ayat: 'Ayat',
  hadis: 'Hadis',
  refleksi: 'Refleksi',
}

function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ── Form (create/edit) ──
const showForm = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const formError = ref('')
const form = ref({
  publish_date: todayIso(),
  type: 'ayat',
  title: '',
  body: '',
  source: '',
  eco_action: '',
  image_url: '',
})

async function load() {
  error.value = ''
  loading.value = true
  try {
    items.value = await api<AdminContent[]>('/v1/admin/contents?limit=100', {
      token: auth.token,
    })
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

function openCreate() {
  editingId.value = null
  form.value = {
    publish_date: todayIso(),
    type: 'ayat',
    title: '',
    body: '',
    source: '',
    eco_action: '',
    image_url: '',
  }
  formError.value = ''
  showForm.value = true
}

function openEdit(c: AdminContent) {
  editingId.value = c.id
  form.value = {
    publish_date: c.publish_date,
    type: c.type,
    title: c.title ?? '',
    body: c.body,
    source: c.source ?? '',
    eco_action: c.eco_action ?? '',
    image_url: c.image_url ?? '',
  }
  formError.value = ''
  showForm.value = true
}

function validate(): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.value.publish_date)) return 'Tanggal tayang wajib diisi.'
  if (!(form.value.type in TYPE_LABEL)) return 'Tipe konten tidak valid.'
  if (form.value.body.trim().length === 0) return 'Isi kutipan wajib diisi.'
  return ''
}

async function submitForm() {
  formError.value = validate()
  if (formError.value) return
  saving.value = true
  const payload = {
    publish_date: form.value.publish_date,
    type: form.value.type,
    title: form.value.title.trim() || null,
    body: form.value.body.trim(),
    source: form.value.source.trim() || null,
    eco_action: form.value.eco_action.trim() || null,
    image_url: form.value.image_url.trim() || null,
  }
  try {
    if (editingId.value === null) {
      await api('/v1/admin/contents', { method: 'POST', body: payload, token: auth.token })
      toast.show('Konten harian dijadwalkan.')
    } else {
      await api(`/v1/admin/contents/${editingId.value}`, {
        method: 'PATCH',
        body: payload,
        token: auth.token,
      })
      toast.show('Perubahan konten tersimpan.')
    }
    showForm.value = false
    await load()
  } catch (err) {
    formError.value =
      err instanceof ApiError ? err.message : 'Terjadi kesalahan saat menyimpan konten.'
  } finally {
    saving.value = false
  }
}

async function removeContent(c: AdminContent) {
  if (
    !confirm(
      `Hapus konten "${c.title ?? c.publish_date}"? Tindakan ini tercatat di audit log.`,
    )
  ) {
    return
  }
  try {
    await api(`/v1/admin/contents/${c.id}`, { method: 'DELETE', token: auth.token })
    toast.show('Konten harian dihapus.')
    await load()
  } catch (err) {
    toast.show(err instanceof ApiError ? err.message : 'Gagal menghapus konten.')
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00`))
}

const upcomingCount = computed(
  () => items.value.filter((c) => !c.is_published).length,
)

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Konten Harian</h1>
      <p>
        {{ items.length }} konten terjadwal · {{ upcomingCount }} menunggu tayang — kartu
        "Kutipan Hari Ini" di aplikasi
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
        @click="openCreate"
      >
        <i
          class="fas fa-plus"
          aria-hidden="true"
        />
        Jadwalkan Konten
      </BaseButton>
    </div>
  </div>

  <!-- Form panel (create/edit) -->
  <div
    v-if="showForm"
    class="panel form-panel"
  >
    <div class="panel-head">
      <div>
        <h2>{{ editingId === null ? 'Jadwalkan Konten' : 'Ubah Konten' }}</h2>
        <div class="sub">
          Satu konten per hari — hari tanpa jadwal otomatis menampilkan kutipan bank terkurasi
        </div>
      </div>
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        aria-label="Tutup form"
        @click="showForm = false"
      >
        <i
          class="fas fa-xmark"
          aria-hidden="true"
        />
      </button>
    </div>
    <form
      class="panel-body form-grid"
      @submit.prevent="submitForm"
    >
      <div class="field">
        <label
          class="label"
          for="content-date"
        >Tanggal tayang</label>
        <input
          id="content-date"
          v-model="form.publish_date"
          class="input"
          type="date"
          required
        >
      </div>
      <div class="field">
        <label
          class="label"
          for="content-type"
        >Tipe</label>
        <select
          id="content-type"
          v-model="form.type"
          class="input"
        >
          <option value="ayat">
            Ayat
          </option>
          <option value="hadis">
            Hadis
          </option>
          <option value="refleksi">
            Refleksi
          </option>
        </select>
      </div>
      <div class="field span-2">
        <label
          class="label"
          for="content-title"
        >Judul (opsional)</label>
        <input
          id="content-title"
          v-model="form.title"
          class="input"
          type="text"
          maxlength="200"
          placeholder="mis. Bumi sebagai Amanah"
        >
      </div>
      <div class="field span-2">
        <label
          class="label"
          for="content-body"
        >Isi kutipan / refleksi</label>
        <textarea
          id="content-body"
          v-model="form.body"
          class="input"
          rows="3"
          required
          maxlength="5000"
          placeholder="Teks kutipan yang tampil di kartu wisdom aplikasi"
        />
      </div>
      <div class="field span-2">
        <label
          class="label"
          for="content-source"
        >Sumber (opsional)</label>
        <input
          id="content-source"
          v-model="form.source"
          class="input"
          type="text"
          maxlength="100"
          placeholder="mis. QS Hud: 61"
        >
      </div>
      <div class="field span-2">
        <label
          class="label"
          for="content-action"
        >Aksi hari ini (opsional)</label>
        <input
          id="content-action"
          v-model="form.eco_action"
          class="input"
          type="text"
          maxlength="500"
          placeholder="mis. setor 1 botol ke bank sampah"
        >
      </div>
      <div class="field span-2">
        <label
          class="label"
          for="content-image"
        >URL gambar (opsional)</label>
        <input
          id="content-image"
          v-model="form.image_url"
          class="input"
          type="text"
          maxlength="1000"
          placeholder="https://…"
        >
      </div>
      <p
        v-if="formError"
        class="field-error span-2"
        role="alert"
      >
        {{ formError }}
      </p>
      <div class="span-2 form-actions">
        <BaseButton
          variant="primary"
          type="submit"
          :disabled="saving"
        >
          <i
            class="fas fa-floppy-disk"
            aria-hidden="true"
          />
          {{ saving ? 'Menyimpan…' : 'Simpan Konten' }}
        </BaseButton>
        <BaseButton
          variant="outline"
          type="button"
          @click="showForm = false"
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
        v-for="n in 4"
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
      class="panel-body contents-error"
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

  <!-- Tabel konten -->
  <div
    v-else
    class="panel"
  >
    <div class="panel-head">
      <div>
        <h2>Daftar Konten</h2>
        <div class="sub">
          Konten bertanggal hari ini langsung tayang di beranda aplikasi
        </div>
      </div>
    </div>
    <div
      v-if="items.length === 0"
      class="panel-body contents-empty"
    >
      <i
        class="fas fa-calendar-day"
        aria-hidden="true"
      />
      <p>
        Belum ada konten terjadwal — aplikasi menampilkan kutipan bank terkurasi.
        Jadwalkan konten pertama dengan tombol "Jadwalkan Konten".
      </p>
    </div>
    <div
      v-else
      class="table-wrap"
    >
      <table class="data">
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Tipe</th>
            <th>Konten</th>
            <th>Aksi Hari Ini</th>
            <th>Status</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in items"
            :key="c.id"
          >
            <td data-label="Tanggal">
              <strong>{{ formatDate(c.publish_date) }}</strong>
            </td>
            <td data-label="Tipe">
              {{ TYPE_LABEL[c.type] ?? c.type }}
            </td>
            <td data-label="Konten">
              <strong>{{ c.title ?? '—' }}</strong>
              <span class="sub-cell">"{{ c.body.length > 90 ? `${c.body.slice(0, 90)}…` : c.body }}"</span>
              <span
                v-if="c.source"
                class="sub-cell"
              >— {{ c.source }}</span>
            </td>
            <td data-label="Aksi Hari Ini">
              {{ c.eco_action ?? '—' }}
            </td>
            <td data-label="Status">
              <span
                class="badge"
                :class="c.is_published ? 'badge-active' : 'badge-pending'"
              >{{ c.is_published ? 'Tayang' : 'Terjadwal' }}</span>
            </td>
            <td data-label="Aksi">
              <div class="row-actions">
                <button
                  v-if="canWrite"
                  class="btn btn-outline btn-sm"
                  type="button"
                  @click="openEdit(c)"
                >
                  Ubah
                </button>
                <button
                  v-if="canDelete"
                  class="btn btn-danger btn-sm"
                  type="button"
                  @click="removeContent(c)"
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
.contents-error {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-danger-strong);
  flex-wrap: wrap;
}
.contents-empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: var(--space-6);
}
.contents-empty i {
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
@media (max-width: 767px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-grid .span-2 {
    grid-column: span 1;
  }
}
</style>
