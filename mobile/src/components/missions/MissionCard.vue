<script setup lang="ts">
/**
 * Kartu misi (Sprint 4) — 1:1 pola `misi.html`: ikon, judul, poin, deskripsi,
 * progress bar (auto_scan), aksi klaim, catatan consent, chip status.
 * Keadaan kartu dari `utils/missions.ts` (available/progress/waiting/done/rejected).
 */
import { computed } from 'vue'

import type { Mission } from '@/types/mission'
import { claimStatusMeta, missionIcon, missionProgress, missionState, missionTypeLabel } from '@/utils/missions'

const props = defineProps<{ mission: Mission }>()

const emit = defineEmits<{
  /** Minta buka alur unggah bukti (photo). */
  'claim-photo': []
  /** Klaim manual / auto_scan → tampilkan info "menyusul Sprint 5". */
  'claim-unavailable': []
}>()

const state = computed(() => missionState(props.mission))
const icon = computed(() => missionIcon(props.mission))
const progress = computed(() => missionProgress(props.mission))
const statusMeta = computed(() =>
  props.mission.my_claim ? claimStatusMeta(props.mission.my_claim) : null,
)

function onPrimary() {
  if (state.value === 'available') {
    if (props.mission.verification === 'photo') emit('claim-photo')
    else emit('claim-unavailable')
    return
  }
  if (state.value === 'rejected') {
    emit('claim-photo')
    return
  }
  emit('claim-unavailable')
}
</script>

<template>
  <article
    class="mission-card"
    :class="{ done: state === 'done', waiting: state === 'waiting', rejected: state === 'rejected' }"
  >
    <div
      class="mc-icon"
      aria-hidden="true"
    >
      <i
        class="fas"
        :class="icon"
      />
    </div>
    <div class="mc-body">
      <div class="mc-head">
        <h3>{{ mission.title }}</h3>
        <span class="pts">+{{ mission.points }}</span>
      </div>
      <p class="mc-desc">
        {{ mission.description }}
      </p>
      <span class="mc-type">{{ missionTypeLabel(mission.type) }} · {{ mission.required_count }}× aksi</span>

      <!-- Progres auto_scan (progres dari scan — diisi mulai Sprint 5) -->
      <template v-if="mission.verification === 'auto_scan'">
        <div
          class="pbar"
          role="progressbar"
          :aria-valuenow="progress"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`Progres misi ${mission.title}`"
        >
          <div
            class="pbar-fill"
            :style="{ width: `${progress}%` }"
          />
        </div>
        <p class="mc-status prog">
          {{ mission.my_claim?.progress_count ?? 0 }} dari {{ mission.required_count }} selesai ·
          otomatis dari scan
        </p>
      </template>

      <!-- Aksi klaim -->
      <div
        v-if="state === 'available' || state === 'rejected'"
        class="mc-actions"
      >
        <button
          class="btn btn-sm"
          :class="mission.verification === 'photo' ? 'btn-primary' : 'btn-gold'"
          type="button"
          @click="onPrimary"
        >
          <i
            class="fas"
            :class="mission.verification === 'photo' ? 'fa-cloud-arrow-up' : 'fa-check'"
            aria-hidden="true"
          />
          {{ state === 'rejected' ? 'Unggah Ulang Bukti' : mission.verification === 'photo' ? 'Unggah Bukti' : 'Klaim Poin' }}
        </button>
      </div>
      <p
        v-if="state === 'available' && mission.verification === 'photo'"
        class="upload-note"
      >
        <i
          class="fas fa-circle-info"
          aria-hidden="true"
        />
        Foto mungkin memuat wajah — hanya dilihat admin verifier.
      </p>
      <p
        v-if="state === 'rejected' && mission.my_claim?.review_note"
        class="upload-note reject-note"
      >
        <i
          class="fas fa-comment"
          aria-hidden="true"
        />
        Catatan admin: {{ mission.my_claim.review_note }}
      </p>

      <!-- Status klaim -->
      <p
        v-if="statusMeta && (state === 'waiting' || state === 'done' || state === 'rejected')"
        class="mc-status"
        :class="statusMeta.tone"
      >
        <i
          class="fas"
          :class="statusMeta.icon"
          aria-hidden="true"
        />
        {{ statusMeta.label }}
        <template v-if="state === 'waiting' && mission.my_claim?.submitted_at">
          · dikirim {{ new Date(mission.my_claim.submitted_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) }}
        </template>
      </p>
      <p
        v-else-if="state === 'done'"
        class="mc-status done"
      >
        <i
          class="fas fa-circle-check"
          aria-hidden="true"
        />
        Selesai · +{{ mission.my_claim?.points_awarded }} poin
      </p>
    </div>
  </article>
</template>

<style scoped>
.mission-card {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-1);
  border-left: 4px solid transparent;
  padding: var(--space-4);
  margin-bottom: var(--space-3);
}
.mission-card.done {
  background: var(--color-primary-soft);
  border-left-color: var(--color-primary);
}
.mission-card.waiting {
  border-left-color: var(--color-info);
}
.mission-card.rejected {
  border-left-color: var(--color-danger);
}
.mc-icon {
  width: 46px;
  height: 46px;
  flex: none;
  border-radius: var(--radius-sm);
  background: var(--surface-alt);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.mission-card.done .mc-icon {
  background: var(--color-surface);
}
.mc-body {
  flex: 1;
  min-width: 0;
}
.mc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}
.mc-head h3 {
  font-size: var(--text-md);
  font-family: var(--font-heading);
}
.mc-head .pts {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: var(--text-sm);
  color: var(--color-accent-text);
  white-space: nowrap;
}
.mc-desc {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin: 3px 0 4px;
}
.mc-type {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--color-text-muted);
  background: var(--surface-alt);
  border-radius: var(--radius-pill);
  padding: 2px 8px;
  margin-bottom: var(--space-2);
}
.mc-status {
  font-size: var(--text-xs);
  font-weight: 700;
  margin-top: var(--space-2);
}
.mc-status.prog {
  color: var(--color-primary);
}
.mc-status.wait {
  color: var(--color-info);
}
.mc-status.done {
  color: var(--color-primary-strong);
}
.mc-status.rejected {
  color: var(--color-danger-strong);
}
.mc-status i {
  margin-right: 4px;
}
.mc-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.mc-actions .btn {
  flex: 1;
}
.upload-note {
  display: flex;
  gap: 8px;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  background: var(--color-info-soft);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  margin-top: var(--space-2);
}
.upload-note i {
  color: var(--color-info);
  margin-top: 2px;
}
.reject-note {
  background: var(--color-danger-soft);
}
.reject-note i {
  color: var(--color-danger-strong);
}
</style>
