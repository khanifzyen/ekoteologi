<script setup lang="ts">
/**
 * Antrian Verifikasi Misi (Sprint 5) — 1:1 mockup `verifikasi.html`:
 * preview bukti besar + strip antrian, panel detail pengguna/misi, catatan
 * review (wajib saat tolak — AUDIT.md A2), dan keyboard shortcut A (setujui),
 * R (tolak), ←/→ (pindah antrian). Keputusan tercatat audit log (middleware);
 * pengguna menerima notifikasi in-app + poin lewat ledger saat disetujui.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { API_BASE_URL, ApiError, api } from '@/api/client'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import type { ReviewDecision } from '@/utils/verification'
import {
  claimSubtitle,
  formatUploaded,
  historyLabel,
  nextIndexAfterRemove,
  reviewError,
} from '@/utils/verification'

interface ClaimRow {
  id: number
  status: string
  progress_count: number
  points_awarded: number
  proof_image_url: string | null
  note: string | null
  review_note: string | null
  consent_at: string | null
  submitted_at: string | null
  reviewed_at: string | null
  user: { id: string; full_name: string; city: string | null }
  mission: { id: number; title: string; points: number; verification: string; type?: string }
  user_claims_total: number
}

interface ClaimsPageData {
  items: ClaimRow[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 20

const auth = useAuthStore()
const toast = useToastStore()
const canReview = computed(
  () => auth.user !== null && ['admin', 'verifier'].includes(auth.user.role),
)

const loading = ref(true)
const error = ref('')
const queue = ref<ClaimRow[]>([])
/** Total klaim pending di server (bisa lebih besar dari halaman yang dimuat). */
const pendingTotal = ref(0)
const current = ref(0)
const reviewNote = ref('')
const reviewing = ref(false)
const stageTitle = ref<HTMLElement | null>(null)

const currentItem = computed(() => queue.value[current.value] ?? null)
const proofSrc = computed(() => {
  const url = currentItem.value?.proof_image_url
  return url ? `${API_BASE_URL}${url}` : null
})
const subtitle = computed(() => {
  const item = currentItem.value
  if (!item) return ''
  return claimSubtitle({
    type: item.mission.type ?? 'daily',
    verification: item.mission.verification,
    points: item.mission.points,
  })
})
/** Sisa bukti di server yang belum termuat di halaman ini. */
const remaining = computed(() => Math.max(0, pendingTotal.value - queue.value.length))

async function load() {
  error.value = ''
  loading.value = true
  try {
    const page = await api<ClaimsPageData>(
      `/v1/admin/claims?status=pending&limit=${PAGE_SIZE}`,
      { token: auth.token },
    )
    queue.value = page.items
    pendingTotal.value = page.total
    current.value = 0
    reviewNote.value = ''
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

/** Muat halaman pending berikutnya (dipakai saat antrian halaman habis). */
async function loadMore(): Promise<boolean> {
  try {
    const page = await api<ClaimsPageData>(
      `/v1/admin/claims?status=pending&limit=${PAGE_SIZE}&offset=${queue.value.length}`,
      { token: auth.token },
    )
    queue.value = [...queue.value, ...page.items]
    pendingTotal.value = page.total
    return page.items.length > 0
  } catch {
    return false
  }
}

function focusCurrent() {
  requestAnimationFrame(() => stageTitle.value?.focus())
}

function jumpTo(index: number) {
  if (index >= 0 && index < queue.value.length) {
    current.value = index
    reviewNote.value = ''
    focusCurrent()
  }
}

async function review(decision: ReviewDecision) {
  const item = currentItem.value
  if (!item || reviewing.value) return
  if (!canReview.value) {
    toast.show('Hanya admin dan verifier yang dapat memutuskan klaim.')
    return
  }
  const invalid = reviewError(decision, reviewNote.value)
  if (invalid) {
    toast.show(invalid)
    document.getElementById('review-note')?.focus()
    return
  }

  reviewing.value = true
  try {
    const reviewed = await api<ClaimRow>(`/v1/admin/claims/${item.id}/review`, {
      method: 'POST',
      body: { decision, note: reviewNote.value.trim() || null },
      token: auth.token,
    })
    toast.show(
      decision === 'approved'
        ? `Disetujui: ${reviewed.user.full_name} mendapat +${reviewed.points_awarded} poin · tercatat di audit log.`
        : `Ditolak dengan catatan · ${reviewed.user.full_name} dinotifikasikan.`,
    )
    // Keluarkan dari antrian lokal; ambil halaman berikutnya bila habis.
    queue.value = queue.value.filter((c) => c.id !== item.id)
    pendingTotal.value = Math.max(0, pendingTotal.value - 1)
    reviewNote.value = ''
    if (queue.value.length === 0 && remaining.value > 0) {
      await loadMore()
    }
    current.value = nextIndexAfterRemove(current.value, queue.value.length)
    focusCurrent()
  } catch (err) {
    toast.show(
      err instanceof ApiError ? err.message : 'Keputusan gagal dikirim — coba lagi.',
    )
  } finally {
    reviewing.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target && target.matches('input, textarea, select')) return
  if (!currentItem.value) return
  const key = event.key.toLowerCase()
  if (key === 'a') {
    event.preventDefault()
    void review('approved')
  } else if (key === 'r') {
    event.preventDefault()
    void review('rejected')
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    jumpTo(current.value + 1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    jumpTo(current.value - 1)
  }
}

onMounted(() => {
  void load()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Antrian Verifikasi Misi</h1>
      <p>
        <span class="num">{{ pendingTotal }}</span> bukti menunggu review · foto hanya dilihat
        verifier
      </p>
    </div>
    <span class="badge badge-pending">
      <i
        class="fas fa-hourglass-half"
        aria-hidden="true"
      />
      SLA review: 1×24 jam
    </span>
  </div>

  <!-- Loading -->
  <div
    v-if="loading"
    class="verif-grid"
  >
    <div class="panel">
      <div class="panel-body">
        <BaseSkeleton style="min-height: 380px" />
      </div>
    </div>
    <div class="panel">
      <div class="panel-body">
        <div
          v-for="n in 5"
          :key="n"
          class="sk-row"
        >
          <BaseSkeleton />
        </div>
      </div>
    </div>
  </div>

  <!-- Error -->
  <div
    v-else-if="error"
    class="panel"
  >
    <div
      class="panel-body verif-error"
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

  <!-- Antrian kosong -->
  <div
    v-else-if="queue.length === 0"
    class="panel"
  >
    <div class="panel-body stage-empty">
      <i
        class="fas fa-circle-check"
        aria-hidden="true"
      />
      <h2>Antrian selesai!</h2>
      <p v-if="remaining > 0">
        {{ remaining }} bukti lain masih menunggu — tekan Segarkan untuk memuat ulang.
      </p>
      <p v-else>
        Tidak ada bukti yang menunggu verifikasi. Kerja bagus!
      </p>
    </div>
  </div>

  <!-- ═══ Antrian aktif ═══ -->
  <div
    v-else
    class="verif-grid"
  >
    <!-- Stage: preview bukti -->
    <div class="panel verif-panel">
      <figure
        class="verif-stage"
        aria-live="polite"
      >
        <img
          v-if="proofSrc"
          :src="proofSrc"
          alt="Foto bukti misi yang diverifikasi"
          width="900"
          height="640"
        >
        <div
          v-else
          class="stage-empty"
        >
          <i
            class="fas fa-image"
            aria-hidden="true"
          />
          <p>Bukti tidak tersedia.</p>
        </div>
      </figure>
      <div
        class="queue-strip"
        role="listbox"
        aria-label="Antrian berikutnya"
      >
        <button
          v-for="(item, index) in queue"
          :key="item.id"
          class="strip-item"
          :class="{ on: index === current }"
          type="button"
          role="option"
          :aria-selected="index === current"
          :aria-label="`Bukti ${index + 1} dari ${queue.length}: ${item.mission.title}`"
          @click="jumpTo(index)"
        >
          <img
            v-if="item.proof_image_url"
            :src="`${API_BASE_URL}${item.proof_image_url}`"
            alt=""
            width="64"
            height="64"
            loading="lazy"
          >
          <i
            v-else
            class="fas fa-image"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>

    <!-- Detail & aksi -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2
            ref="stageTitle"
            tabindex="-1"
          >
            {{ currentItem.mission.title }}
          </h2>
          <div class="sub">
            {{ subtitle }}
          </div>
        </div>
      </div>
      <div class="panel-body">
        <dl class="detail-list">
          <div>
            <dt>Pengguna</dt>
            <dd>
              {{ currentItem.user.full_name }}<template v-if="currentItem.user.city">
                · {{ currentItem.user.city }}
              </template>
            </dd>
          </div>
          <div>
            <dt>Diunggah</dt>
            <dd class="num">
              {{ formatUploaded(currentItem.submitted_at) }}
            </dd>
          </div>
          <div>
            <dt>Catatan user</dt>
            <dd>{{ currentItem.note ? `“${currentItem.note}”` : '—' }}</dd>
          </div>
          <div>
            <dt>Sejarah</dt>
            <dd>{{ historyLabel(currentItem.user_claims_total) }}</dd>
          </div>
          <div>
            <dt>Consent foto</dt>
            <dd>
              <span
                class="badge"
                :class="currentItem.consent_at ? 'badge-active' : 'badge-blocked'"
              >{{ currentItem.consent_at ? 'Tercatat' : 'Tidak ada' }}</span>
            </dd>
          </div>
        </dl>

        <div class="reject-note">
          <label
            class="label"
            for="review-note"
          >Catatan review (wajib bila menolak)</label>
          <textarea
            id="review-note"
            v-model="reviewNote"
            placeholder="Contoh: foto tidak menunjukkan timbangan, mohon unggah ulang…"
            maxlength="1000"
          />
        </div>

        <div
          v-if="canReview"
          class="verif-actions"
        >
          <BaseButton
            variant="success"
            :disabled="reviewing"
            @click="review('approved')"
          >
            <i
              class="fas fa-check"
              aria-hidden="true"
            />
            Setujui
          </BaseButton>
          <BaseButton
            variant="danger"
            :disabled="reviewing"
            @click="review('rejected')"
          >
            <i
              class="fas fa-xmark"
              aria-hidden="true"
            />
            Tolak
          </BaseButton>
        </div>
        <p
          v-else
          class="verif-readonly"
        >
          <i
            class="fas fa-circle-info"
            aria-hidden="true"
          />
          Hanya admin dan verifier yang dapat memutuskan klaim.
        </p>
        <div
          v-if="canReview"
          class="kbd-row"
          aria-hidden="true"
        >
          <span><span class="kbd">A</span> setujui</span>
          <span><span class="kbd">R</span> tolak</span>
          <span><span class="kbd">←</span><span class="kbd">→</span> pindah antrian</span>
        </div>
        <p class="verif-hint">
          Keputusan tercatat di audit log · pengguna menerima notifikasi in-app
          (push menyusul Sprint 6).
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.verif-panel {
  display: flex;
  flex-direction: column;
}
.sk-row {
  padding: var(--space-2) 0;
}
.verif-error {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-danger-strong);
  flex-wrap: wrap;
}
.stage-empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: var(--space-7);
}
.stage-empty i {
  font-size: 40px;
  color: var(--color-success);
  display: block;
  margin-bottom: var(--space-3);
}
.stage-empty h2 {
  color: var(--color-heading);
  margin-bottom: 4px;
}
.strip-item {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex: none;
  border: 2px solid transparent;
  cursor: pointer;
  opacity: 0.7;
  padding: 0;
  background: var(--surface-alt);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-300);
}
.strip-item.on {
  border-color: var(--color-primary);
  opacity: 1;
}
.strip-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.reject-note {
  margin-top: var(--space-4);
}
.reject-note label {
  font-size: var(--text-sm);
  font-weight: 700;
  display: block;
  margin-bottom: 6px;
}
.reject-note textarea {
  width: 100%;
  min-height: 72px;
  resize: vertical;
  border: 1.5px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  font-family: var(--font-body);
  font-size: var(--text-sm);
}
.verif-readonly {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-top: var(--space-4);
}
.verif-hint {
  margin-top: var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
</style>
