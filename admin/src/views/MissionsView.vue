<script setup lang="ts">
/**
 * Manajemen Misi (Sprint 4) — CRUD sesuai story rencana: periode, poin, mode
 * verifikasi. Pola form panel + input (konsisten gaya admin). Tulis:
 * admin|editor; hapus: admin. Antrian klaim ditampilkan read-only — aksi
 * approve/reject adalah modul Verifikasi (Sprint 5).
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { ApiError, api } from '@/api/client'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

interface AdminMission {
  id: number
  title: string
  description: string | null
  type: string
  icon: string | null
  points: number
  verification: string
  required_count: number
  start_at: string | null
  end_at: string | null
  is_active: boolean
  claims_total: number
  claims_pending: number
}

interface MissionPageData {
  items: AdminMission[]
  total: number
  limit: number
  offset: number
}

interface ClaimRow {
  id: number
  status: string
  submitted_at: string | null
  consent_at: string | null
  proof_image_url: string | null
  user: { full_name: string; city: string | null }
  mission: { title: string; points: number }
}

const auth = useAuthStore()
const toast = useToastStore()
const canWrite = computed(() =>
  auth.user !== null && ['admin', 'editor'].includes(auth.user.role),
)
const canDelete = computed(() => auth.user?.role === 'admin')

const loading = ref(true)
const error = ref('')
const items = ref<AdminMission[]>([])
const total = ref(0)
const claims = ref<ClaimRow[]>([])
const claimsTotal = ref(0)

const TYPE_LABEL: Record<string, string> = {
  daily: 'Harian',
  weekly: 'Mingguan',
  special: 'Spesial',
}
const VERIF_LABEL: Record<string, string> = {
  photo: 'Foto (review admin)',
  auto_scan: 'Otomatis dari scan',
  manual: 'Manual (auto-approve)',
}

// ── Form (create/edit) ──
const showForm = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const formError = ref('')
const form = ref({
  title: '',
  description: '',
  type: 'daily',
  points: 10,
  verification: 'photo',
  required_count: 1,
  icon: '',
  start_at: '',
  end_at: '',
  is_active: true,
})

async function load() {
  error.value = ''
  loading.value = true
  try {
    const [page, claimPage] = await Promise.all([
      api<MissionPageData>('/v1/admin/missions?limit=50', { token: auth.token }),
      api<{ items: ClaimRow[]; total: number }>('/v1/admin/claims?status=pending&limit=8', {
        token: auth.token,
      }),
    ])
    items.value = page.items
    total.value = page.total
    claims.value = claimPage.items
    claimsTotal.value = claimPage.total
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
    title: '',
    description: '',
    type: 'daily',
    points: 10,
    verification: 'photo',
    required_count: 1,
    icon: '',
    start_at: '',
    end_at: '',
    is_active: true,
  }
  formError.value = ''
  showForm.value = true
}

function openEdit(m: AdminMission) {
  editingId.value = m.id
  form.value = {
    title: m.title,
    description: m.description ?? '',
    type: m.type,
    points: m.points,
    verification: m.verification,
    required_count: m.required_count,
    icon: m.icon ?? '',
    start_at: toLocalInput(m.start_at),
    end_at: toLocalInput(m.end_at),
    is_active: m.is_active,
  }
  formError.value = ''
  showForm.value = true
}

function toLocalInput(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function validate(): string {
  if (form.value.title.trim().length < 3) return 'Judul minimal 3 karakter.'
  if (form.value.points < 1) return 'Poin minimal 1.'
  if (!(form.value.verification in VERIF_LABEL)) return 'Mode verifikasi tidak valid.'
  if (
    form.value.start_at &&
    form.value.end_at &&
    new Date(form.value.start_at) >= new Date(form.value.end_at)
  ) {
    return 'Waktu mulai harus sebelum waktu selesai.'
  }
  return ''
}

async function submitForm() {
  formError.value = validate()
  if (formError.value) return
  saving.value = true
  const payload = {
    title: form.value.title.trim(),
    description: form.value.description.trim() || null,
    type: form.value.type,
    points: form.value.points,
    verification: form.value.verification,
    required_count: form.value.required_count,
    icon: form.value.icon.trim() || null,
    start_at: form.value.start_at ? new Date(form.value.start_at).toISOString() : null,
    end_at: form.value.end_at ? new Date(form.value.end_at).toISOString() : null,
    is_active: form.value.is_active,
  }
  try {
    if (editingId.value === null) {
      await api('/v1/admin/missions', {
        method: 'POST',
        body: payload,
        token: auth.token,
      })
      toast.show('Misi baru dibuat.')
    } else {
      await api(`/v1/admin/missions/${editingId.value}`, {
        method: 'PATCH',
        body: payload,
        token: auth.token,
      })
      toast.show('Perubahan misi tersimpan.')
    }
    showForm.value = false
    await load()
  } catch (err) {
    formError.value =
      err instanceof ApiError ? err.message : 'Terjadi kesalahan saat menyimpan misi.'
  } finally {
    saving.value = false
  }
}

async function toggleActive(m: AdminMission) {
  try {
    await api(`/v1/admin/missions/${m.id}`, {
      method: 'PATCH',
      body: { is_active: !m.is_active },
      token: auth.token,
    })
    toast.show(m.is_active ? `Misi "${m.title}" dinonaktifkan.` : `Misi "${m.title}" diaktifkan.`)
    await load()
  } catch (err) {
    toast.show(err instanceof ApiError ? err.message : 'Gagal mengubah status misi.')
  }
}

async function removeMission(m: AdminMission) {
  if (
    !confirm(
      `Hapus misi "${m.title}"? Tindakan ini tercatat di audit log dan tidak dapat dibatalkan.`,
    )
  ) {
    return
  }
  try {
    await api(`/v1/admin/missions/${m.id}`, { method: 'DELETE', token: auth.token })
    toast.show(`Misi "${m.title}" dihapus.`)
    await load()
  } catch (err) {
    toast.show(err instanceof ApiError ? err.message : 'Gagal menghapus misi.')
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatTimeOnly(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  )
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Manajemen Misi</h1>
      <p>{{ total }} misi terdaftar · {{ claimsTotal }} klaim menunggu verifikasi</p>
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
        Tambah Misi
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
        <h2>{{ editingId === null ? 'Tambah Misi' : 'Ubah Misi' }}</h2>
        <div class="sub">
          Periode, poin, dan mode verifikasi menentukan alur klaim di aplikasi
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
      <div class="field span-2">
        <label
          class="label"
          for="mission-title"
        >Judul misi</label>
        <input
          id="mission-title"
          v-model="form.title"
          class="input"
          type="text"
          required
          maxlength="150"
          placeholder="mis. Setor 1 kg Plastik ke Bank Sampah"
        >
      </div>
      <div class="field span-2">
        <label
          class="label"
          for="mission-desc"
        >Deskripsi</label>
        <textarea
          id="mission-desc"
          v-model="form.description"
          class="input"
          rows="2"
          placeholder="Petunjuk singkat untuk pengguna"
        />
      </div>
      <div class="field">
        <label
          class="label"
          for="mission-type"
        >Tipe</label>
        <select
          id="mission-type"
          v-model="form.type"
          class="input"
        >
          <option value="daily">
            Harian
          </option>
          <option value="weekly">
            Mingguan
          </option>
          <option value="special">
            Spesial
          </option>
        </select>
      </div>
      <div class="field">
        <label
          class="label"
          for="mission-points"
        >Poin</label>
        <input
          id="mission-points"
          v-model.number="form.points"
          class="input"
          type="number"
          min="1"
          max="10000"
          required
        >
      </div>
      <div class="field">
        <label
          class="label"
          for="mission-verif"
        >Mode verifikasi</label>
        <select
          id="mission-verif"
          v-model="form.verification"
          class="input"
        >
          <option value="photo">
            Foto (review admin)
          </option>
          <option value="auto_scan">
            Otomatis dari scan
          </option>
          <option value="manual">
            Manual (auto-approve)
          </option>
        </select>
      </div>
      <div class="field">
        <label
          class="label"
          for="mission-count"
        >Jumlah aksi (target)</label>
        <input
          id="mission-count"
          v-model.number="form.required_count"
          class="input"
          type="number"
          min="1"
          max="1000"
        >
      </div>
      <div class="field">
        <label
          class="label"
          for="mission-start"
        >Mulai (opsional)</label>
        <input
          id="mission-start"
          v-model="form.start_at"
          class="input"
          type="datetime-local"
        >
      </div>
      <div class="field">
        <label
          class="label"
          for="mission-end"
        >Selesai (opsional)</label>
        <input
          id="mission-end"
          v-model="form.end_at"
          class="input"
          type="datetime-local"
        >
      </div>
      <div class="field">
        <label
          class="label"
          for="mission-icon"
        >Ikon (FontAwesome, opsional)</label>
        <input
          id="mission-icon"
          v-model="form.icon"
          class="input"
          type="text"
          placeholder="fa-recycle"
        >
      </div>
      <label class="check-field">
        <input
          v-model="form.is_active"
          type="checkbox"
        >
        Misi aktif (tampil di aplikasi)
      </label>
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
          {{ saving ? 'Menyimpan…' : 'Simpan Misi' }}
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
      class="panel-body missions-error"
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

  <template v-else>
    <!-- Tabel misi -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Daftar Misi</h2>
          <div class="sub">
            Anti dobel klaim: 1× per pengguna per periode (constraint DB)
          </div>
        </div>
      </div>
      <div
        v-if="items.length === 0"
        class="panel-body missions-empty"
      >
        <i
          class="fas fa-bullseye"
          aria-hidden="true"
        />
        <p>Belum ada misi. Buat misi pertama dengan tombol "Tambah Misi".</p>
      </div>
      <div
        v-else
        class="table-wrap"
      >
        <table class="data">
          <thead>
            <tr>
              <th>Misi</th>
              <th>Tipe</th>
              <th>Poin</th>
              <th>Verifikasi</th>
              <th>Periode</th>
              <th>Klaim</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in items"
              :key="m.id"
            >
              <td data-label="Misi">
                <div class="cell-user">
                  <span class="mission-ic"><i
                    class="fas"
                    :class="m.icon ?? 'fa-bullseye'"
                    aria-hidden="true"
                  /></span>
                  <div>
                    <strong>{{ m.title }}</strong>
                    <span>{{ m.description ?? '—' }}</span>
                  </div>
                </div>
              </td>
              <td data-label="Tipe">
                {{ TYPE_LABEL[m.type] ?? m.type }}
              </td>
              <td data-label="Poin">
                <strong class="num">+{{ m.points }}</strong>
              </td>
              <td data-label="Verifikasi">
                {{ VERIF_LABEL[m.verification] ?? m.verification }}
                <span
                  v-if="m.required_count > 1"
                  class="sub-cell"
                >target {{ m.required_count }}×</span>
              </td>
              <td data-label="Periode">
                {{ formatDateTime(m.start_at) }} → {{ formatDateTime(m.end_at) }}
              </td>
              <td data-label="Klaim">
                <strong class="num">{{ m.claims_total }}</strong>
                <span
                  v-if="m.claims_pending > 0"
                  class="sub-cell warn"
                >{{ m.claims_pending }} menunggu</span>
              </td>
              <td data-label="Status">
                <span
                  class="badge"
                  :class="m.is_active ? 'badge-active' : 'badge-blocked'"
                >{{ m.is_active ? 'Aktif' : 'Nonaktif' }}</span>
              </td>
              <td data-label="Aksi">
                <div class="row-actions">
                  <button
                    v-if="canWrite"
                    class="btn btn-outline btn-sm"
                    type="button"
                    @click="openEdit(m)"
                  >
                    Ubah
                  </button>
                  <button
                    v-if="canWrite"
                    class="btn btn-outline btn-sm"
                    type="button"
                    @click="toggleActive(m)"
                  >
                    {{ m.is_active ? 'Nonaktifkan' : 'Aktifkan' }}
                  </button>
                  <button
                    v-if="canDelete && m.claims_total === 0"
                    class="btn btn-danger btn-sm"
                    type="button"
                    @click="removeMission(m)"
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

    <!-- Antrian klaim (ringkasan — aksi penuh di modul Verifikasi) -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Klaim Masuk (Antrian Verifikasi)</h2>
          <div class="sub">
            Bukti foto yang menunggu keputusan — setujui/tolak di modul Verifikasi
          </div>
        </div>
        <RouterLink
          class="btn btn-primary btn-sm"
          to="/verifikasi"
        >
          <i
            class="fas fa-clipboard-check"
            aria-hidden="true"
          />
          Buka Verifikasi
        </RouterLink>
      </div>
      <div
        v-if="claims.length === 0"
        class="panel-body missions-empty"
      >
        <i
          class="fas fa-clipboard-check"
          aria-hidden="true"
        />
        <p>Antrian kosong — tidak ada bukti yang menunggu verifikasi.</p>
      </div>
      <div
        v-else
        class="table-wrap"
      >
        <table class="data">
          <thead>
            <tr>
              <th>Pengguna</th>
              <th>Misi</th>
              <th>Dikirim</th>
              <th>Consent</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in claims"
              :key="c.id"
            >
              <td data-label="Pengguna">
                <strong>{{ c.user.full_name }}</strong>
                <span class="sub-cell">{{ c.user.city ?? '—' }}</span>
              </td>
              <td data-label="Misi">
                {{ c.mission.title }} <span class="sub-cell">+{{ c.mission.points }} poin</span>
              </td>
              <td
                data-label="Dikirim"
                class="num"
              >
                {{ formatTimeOnly(c.submitted_at) }}
              </td>
              <td data-label="Consent">
                <span
                  class="badge"
                  :class="c.consent_at ? 'badge-active' : 'badge-blocked'"
                >{{ c.consent_at ? 'Tercatat' : 'Tidak ada' }}</span>
              </td>
              <td data-label="Status">
                <span class="badge badge-pending">Menunggu</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
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
.check-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  padding-top: var(--space-5);
  cursor: pointer;
}
.form-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.sk-row {
  padding: var(--space-2) 0;
}
.missions-error {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-danger-strong);
  flex-wrap: wrap;
}
.missions-empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: var(--space-6);
}
.missions-empty i {
  font-size: var(--text-xl);
  display: block;
  margin-bottom: var(--space-2);
}
.mission-ic {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--radius-sm);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
}
.sub-cell {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.sub-cell.warn {
  color: var(--color-accent-text);
  font-weight: 700;
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
