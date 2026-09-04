<script setup lang="ts">
/**
 * Composer push (Sprint 8) — story "Admin: composer push (semua/segmen) —
 * role admin saja; audit log". Mengirim satu broadcast ke semua/segmen via
 * `POST /v1/admin/push/broadcast` (server menolak role non-admin, mencatat
 * audit eksplisit, membuat 1 baris broadcast `notifications`, lalu push FCM
 * best-effort ke token segmen). Rekap penerima/token per segmen dipakai
 * sebagai preview sebelum kirim; riwayat broadcast dari payload rekap.
 */
import { computed, onMounted, ref } from 'vue'

import { ApiError, api } from '@/api/client'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import {
  BODY_MAX,
  BODY_MIN,
  TITLE_MAX,
  TITLE_MIN,
  broadcastSummary,
  composerError,
  historyLabel,
  type BroadcastResult,
  type SegmentStat,
} from '@/utils/push'

interface NotificationRow {
  id: number
  title: string | null
  body: string | null
  type: string | null
  payload: { kind?: string; segment?: string; recipients?: number; tokens?: number; sent?: number } | null
  read_at: string | null
  created_at: string
}

const auth = useAuthStore()
const toast = useToastStore()
const isAdmin = computed(() => auth.user?.role === 'admin')

const loading = ref(true)
const error = ref('')
const segments = ref<SegmentStat[]>([])
const history = ref<NotificationRow[]>([])

// ── Composer ──
const sending = ref(false)
const formError = ref('')
const result = ref<BroadcastResult | null>(null)
const form = ref({ title: '', body: '', segment: 'all' })

const SEGMENT_FALLBACK: Record<string, string> = {
  all: 'Semua pengguna aktif',
  aktif_7hari: 'Aktif 7 hari terakhir',
  pasif_7hari: 'Pasif lebih dari 7 hari',
  bertoken: 'Punya token push (FCM)',
}

function segmentLabel(key: string): string {
  return (
    segments.value.find((s) => s.segment === key)?.label ?? SEGMENT_FALLBACK[key] ?? key
  )
}

const selectedStat = computed(
  () => segments.value.find((s) => s.segment === form.value.segment) ?? null,
)

const fmt = new Intl.NumberFormat('id-ID')

async function load() {
  error.value = ''
  loading.value = true
  try {
    const segResp = await api<{ items: SegmentStat[] }>('/v1/admin/push/segments', {
      token: auth.token,
    })
    segments.value = segResp.items
    history.value = await api<NotificationRow[]>('/v1/admin/push/history', {
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

function validate(): string {
  return composerError(form.value.title, form.value.body)
}

async function send() {
  formError.value = validate()
  if (formError.value) return
  const stat = selectedStat.value
  const ringkas = stat
    ? `${fmt.format(stat.recipients)} penerima · ${fmt.format(stat.tokens)} perangkat`
    : 'segmen tidak diketahui'
  if (!confirm(`Kirim push ke ${ringkas}? Tindakan ini tercatat di audit log.`)) return

  sending.value = true
  try {
    result.value = await api<BroadcastResult>('/v1/admin/push/broadcast', {
      method: 'POST',
      body: {
        title: form.value.title.trim(),
        body: form.value.body.trim(),
        segment: form.value.segment,
      },
      token: auth.token,
    })
    toast.show(broadcastSummary(result.value))
    form.value = { title: '', body: '', segment: form.value.segment }
    await load()
  } catch (err) {
    formError.value =
      err instanceof ApiError ? err.message : 'Terjadi kesalahan saat mengirim push.'
  } finally {
    sending.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Push Notifikasi</h1>
      <p>
        Kirim pengumuman ke aplikasi pengguna — tercatat di audit log; tanpa
        token FCM, pesan tetap tampil sebagai notifikasi in-app.
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
    </div>
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
      class="panel-body push-error"
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
    <!-- Ringkasan segmen -->
    <div class="segment-grid">
      <div
        v-for="s in segments"
        :key="s.segment"
        class="panel segment-card"
        :class="{ selected: s.segment === form.segment }"
      >
        <div class="segment-label">
          {{ s.label }}
        </div>
        <div class="segment-count">
          {{ fmt.format(s.recipients) }}
        </div>
        <div class="segment-sub">
          penerima · {{ fmt.format(s.tokens) }} perangkat push
        </div>
      </div>
    </div>

    <!-- Composer -->
    <div
      v-if="isAdmin"
      class="panel form-panel"
    >
      <div class="panel-head">
        <div>
          <h2>Tulis Pengumuman</h2>
          <div class="sub">
            Notifikasi in-app untuk seluruh penerima + push ke perangkat yang
            terdaftar
          </div>
        </div>
      </div>
      <form
        class="panel-body form-grid"
        @submit.prevent="send"
      >
        <div class="field span-2">
          <label
            class="label"
            for="push-title"
          >Judul</label>
          <input
            id="push-title"
            v-model="form.title"
            class="input"
            type="text"
            :minlength="TITLE_MIN"
            :maxlength="TITLE_MAX"
            required
            placeholder="mis. Misi Spesial Akhir Pekan"
          >
        </div>
        <div class="field span-2">
          <label
            class="label"
            for="push-body"
          >Isi pesan</label>
          <textarea
            id="push-body"
            v-model="form.body"
            class="input"
            rows="3"
            :minlength="BODY_MIN"
            :maxlength="BODY_MAX"
            required
            placeholder="Pesan singkat yang tampil di aplikasi pengguna"
          />
        </div>
        <fieldset class="field span-2 segment-field">
          <legend class="label">
            Segmen penerima
          </legend>
          <div class="chip-row">
            <button
              v-for="s in segments"
              :key="s.segment"
              type="button"
              class="segment-chip"
              :class="{ active: form.segment === s.segment }"
              :aria-pressed="form.segment === s.segment"
              @click="form.segment = s.segment"
            >
              {{ s.label }}
              <span class="chip-count">{{ fmt.format(s.recipients) }}</span>
            </button>
          </div>
        </fieldset>
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
            :disabled="sending"
          >
            <i
              class="fas fa-paper-plane"
              aria-hidden="true"
            />
            {{ sending ? 'Mengirim…' : 'Kirim Push' }}
          </BaseButton>
        </div>
      </form>
    </div>
    <div
      v-else
      class="panel"
    >
      <div class="panel-body push-note">
        <i
          class="fas fa-lock"
          aria-hidden="true"
        />
        Hanya role Admin yang dapat mengirim push — sesuai kebijakan composer.
      </div>
    </div>

    <!-- Hasil kirim terakhir -->
    <div
      v-if="result"
      class="panel"
    >
      <div
        class="panel-body push-result"
        role="status"
      >
        <i
          class="fas fa-circle-check"
          aria-hidden="true"
        />
        <div>
          <strong>"{{ result.title }}"</strong>
          <span>{{ broadcastSummary(result) }}</span>
        </div>
      </div>
    </div>

    <!-- Riwayat -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Riwayat Broadcast</h2>
          <div class="sub">
            20 pengiriman terakhir — rekap tersimpan di audit log
          </div>
        </div>
      </div>
      <div
        v-if="history.length === 0"
        class="panel-body push-empty"
      >
        <i
          class="fas fa-bell"
          aria-hidden="true"
        />
        <p>Belum ada broadcast yang dikirim.</p>
      </div>
      <div
        v-else
        class="table-wrap"
      >
        <table class="data">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Pesan</th>
              <th>Segmen</th>
              <th>Penerima</th>
              <th>Perangkat</th>
              <th>Terkirim</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in history"
              :key="row.id"
            >
              <td data-label="Waktu">
                <strong>{{ historyLabel(row.created_at, '') }}</strong>
              </td>
              <td data-label="Pesan">
                <strong>{{ row.title ?? '—' }}</strong>
                <span class="sub-cell">{{ row.body }}</span>
              </td>
              <td data-label="Segmen">
                {{ segmentLabel(row.payload?.segment ?? 'all') }}
              </td>
              <td data-label="Penerima">
                {{ fmt.format(row.payload?.recipients ?? 0) }}
              </td>
              <td data-label="Perangkat">
                {{ fmt.format(row.payload?.tokens ?? 0) }}
              </td>
              <td data-label="Terkirim">
                <span class="badge badge-active">{{ fmt.format(row.payload?.sent ?? 0) }}</span>
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
.sk-row {
  padding: var(--space-2) 0;
}
.push-error {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-danger-strong);
  flex-wrap: wrap;
}
.segment-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.segment-card {
  padding: var(--space-4);
  border-left: 3px solid var(--color-primary);
}
.segment-card.selected {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
.segment-label {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.segment-count {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--color-text);
}
.segment-sub {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
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
.segment-field {
  border: 0;
  padding: 0;
  margin: 0;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.segment-chip {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: var(--radius-pill);
  padding: var(--space-2) var(--space-3);
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  font-size: var(--text-sm);
}
.segment-chip.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  font-weight: 600;
}
.chip-count {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.push-note,
.push-result {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text-muted);
}
.push-result i {
  color: var(--color-success);
}
.push-result span {
  display: block;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.push-empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: var(--space-6);
}
.push-empty i {
  font-size: var(--text-xl);
  display: block;
  margin-bottom: var(--space-2);
}
.sub-cell {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
@media (max-width: 1023px) {
  .segment-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 767px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-grid .span-2 {
    grid-column: span 1;
  }
  .segment-grid {
    grid-template-columns: 1fr;
  }
}
</style>
