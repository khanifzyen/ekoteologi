<script setup lang="ts">
/**
 * Profil (Sprint 1/5/6): identitas, statistik dampak (scan, misi, lencana),
 * progres level, dan grid lencana — data dari `GET /v1/profile` (Sprint 6
 * menambah `scans_total`/`missions_approved`/`badges_earned`) + `GET /v1/badges`
 * (badge engine — lencana hidup otomatis dari aksi).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, apiUrl } from '@/api/client'
import BottomNav from '@/components/layout/BottomNav.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import StateError from '@/components/state/StateError.vue'
import StateSkeleton from '@/components/state/StateSkeleton.vue'
import { fetchBadges } from '@/services/missions'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import type { BadgeItem } from '@/types/mission'

const router = useRouter()
const toast = useToastStore()
const auth = useAuthStore()

type LoadState = 'loading' | 'error' | 'ready'
const state = ref<LoadState>('loading')
const editing = ref(false)
const saving = ref(false)
const uploading = ref(false)

const editName = ref('')
const editCity = ref('')

/** Lencana (Sprint 6) — best-effort: gagal muat tidak memblokir layar profil. */
const badges = ref<BadgeItem[]>([])
const badgesLoading = ref(true)

const earnedBadges = computed(() => badges.value.filter((b) => b.earned))
const badgesEarnedCount = computed(
  () => auth.profile?.badges_earned ?? earnedBadges.value.length,
)

/** Total aksi nyata — konsisten dengan kartu "Pohon Kebaikanmu" beranda. */
const totalActions = computed(
  () => (auth.profile?.scans_total ?? 0) + (auth.profile?.missions_approved ?? 0),
)

/** Poin tersisa menuju level berikutnya (null saat sudah level puncak). */
const levelRemaining = computed(() => {
  const profile = auth.profile
  if (!profile || !profile.next_level_points) return null
  return Math.max(0, profile.next_level_points - profile.points)
})

const initials = computed(() => {
  const name = auth.user?.full_name ?? ''
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
})

const avatarSrc = computed(() => {
  const url = auth.user?.avatar_url
  return url ? apiUrl(url) : null
})

async function load() {
  state.value = 'loading'
  try {
    await auth.ensureProfile()
    state.value = 'ready'
    void loadBadges()
  } catch (err) {
    state.value = 'error'
    if (err instanceof ApiError && err.status !== 0) toast.show(err.message)
  }
}

async function loadBadges() {
  badgesLoading.value = true
  try {
    badges.value = await fetchBadges()
  } catch {
    badges.value = [] // best-effort — grid lencana saja yang kosong
  } finally {
    badgesLoading.value = false
  }
}

onMounted(load)

function startEdit() {
  editName.value = auth.user?.full_name ?? ''
  editCity.value = auth.user?.city ?? ''
  editing.value = true
}

async function save() {
  if (editName.value.trim().length < 2) {
    toast.show('Nama minimal 2 karakter.')
    return
  }
  saving.value = true
  try {
    await auth.updateProfile({ full_name: editName.value.trim(), city: editCity.value.trim() })
    editing.value = false
    toast.show('Profil berhasil diperbarui.')
  } catch (err) {
    toast.show(err instanceof ApiError ? err.message : 'Gagal menyimpan profil.')
  } finally {
    saving.value = false
  }
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_AVATAR_MB = 2
const fileInput = ref<HTMLInputElement | null>(null)

function pickAvatar() {
  fileInput.value?.click()
}

async function onAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!ALLOWED_TYPES.includes(file.type)) {
    toast.show('Format foto harus JPG, PNG, atau WebP.')
    return
  }
  if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
    toast.show(`Ukuran foto maksimal ${MAX_AVATAR_MB} MB.`)
    return
  }
  uploading.value = true
  try {
    await auth.uploadAvatar(file)
    toast.show('Foto profil diperbarui.')
  } catch (err) {
    toast.show(err instanceof ApiError ? err.message : 'Gagal mengunggah foto.')
  } finally {
    uploading.value = false
  }
}

function logout() {
  if (!window.confirm('Keluar dari akun Anda?')) return
  auth.logout()
  router.replace({ name: 'auth' })
}
</script>

<template>
  <header class="header-curved">
    <p class="greeting">
      Profil
    </p>
    <h1 class="screen-title">
      Akun Saya
    </h1>
  </header>

  <main class="content-overlap">
    <StateSkeleton
      v-if="state === 'loading'"
      :rows="2"
    />
    <StateError
      v-else-if="state === 'error'"
      message="Tidak dapat memuat profil. Periksa koneksi Anda."
      @retry="load"
    />

    <template v-else>
      <div class="card profile-card">
        <div class="profile-head">
          <button
            class="avatar-big"
            type="button"
            :aria-label="uploading ? 'Mengunggah foto…' : 'Ganti foto profil'"
            :disabled="uploading"
            @click="pickAvatar"
          >
            <img
              v-if="avatarSrc"
              :src="avatarSrc"
              alt="Foto profil"
            >
            <template v-else>
              {{ initials }}
            </template>
            <span
              class="avatar-edit"
              aria-hidden="true"
            >
              <i class="fas fa-camera" />
            </span>
          </button>
          <input
            ref="fileInput"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            class="sr-only"
            aria-label="Pilih foto profil"
            @change="onAvatarChange"
          >
          <div class="profile-id">
            <h2>{{ auth.user?.full_name }}</h2>
            <p class="muted">
              {{ auth.user?.email }}
            </p>
            <span class="chip chip-green">
              <i
                class="fas fa-seedling"
                aria-hidden="true"
              />
              Lvl {{ auth.profile?.level ?? 1 }} · {{ auth.profile?.level_title ?? 'Pemula' }}
            </span>
          </div>
        </div>

        <div class="profile-stats">
          <div class="stat">
            <strong data-testid="stat-points">{{ auth.user?.points ?? 0 }}</strong>
            <span>Poin</span>
          </div>
          <div class="stat">
            <strong data-testid="stat-actions">{{ totalActions }}</strong>
            <span>Aksi Nyata</span>
          </div>
          <div class="stat">
            <strong data-testid="stat-streak">{{ auth.profile?.current_streak ?? 0 }}</strong>
            <span>Streak</span>
          </div>
        </div>

        <!-- Progres level (Sprint 6 — server menghitung % dari tangga levels) -->
        <div
          v-if="levelRemaining !== null"
          class="level-progress"
        >
          <div class="level-row">
            <span>Lvl {{ auth.profile?.level }} · {{ auth.profile?.level_title }}</span>
            <strong>{{ levelRemaining }} poin lagi ke {{ auth.profile?.next_level_title }}</strong>
          </div>
          <div
            class="pbar"
            role="progressbar"
            :aria-valuenow="auth.profile?.level_progress ?? 0"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`Progres menuju level ${auth.profile?.next_level}`"
          >
            <div
              class="pbar-fill green"
              :style="{ width: `${auth.profile?.level_progress ?? 0}%` }"
            />
          </div>
        </div>
      </div>

      <!-- Statistik dampak (Sprint 6 — story "statistik dampak, lencana, poin") -->
      <div class="card">
        <div class="section-head tight">
          <h2>Statistik Dampak</h2>
        </div>
        <div class="impact-stats">
          <div class="impact-stat">
            <i
              class="fas fa-camera"
              aria-hidden="true"
            />
            <strong>{{ auth.profile?.scans_total ?? 0 }}</strong>
            <span>Scan Bernilai</span>
          </div>
          <div class="impact-stat">
            <i
              class="fas fa-bullseye"
              aria-hidden="true"
            />
            <strong>{{ auth.profile?.missions_approved ?? 0 }}</strong>
            <span>Misi Selesai</span>
          </div>
          <div class="impact-stat">
            <i
              class="fas fa-award"
              aria-hidden="true"
            />
            <strong>{{ badgesEarnedCount }}</strong>
            <span>Lencana</span>
          </div>
        </div>
      </div>

      <!-- Lencana (Sprint 6 — badge engine; penuh di tab Pencapaian layar Misi) -->
      <div class="card">
        <div class="section-head tight">
          <h2>Lencana</h2>
          <span
            v-if="!badgesLoading && badges.length > 0"
            class="chip chip-green"
          >
            {{ earnedBadges.length }}/{{ badges.length }} diraih
          </span>
        </div>
        <div
          v-if="badgesLoading"
          class="badge-grid"
          aria-label="Memuat lencana"
        >
          <div
            v-for="n in 5"
            :key="n"
            class="badge-cell"
          >
            <div class="badge-medal">
              <span class="skeleton sk-circle" />
            </div>
          </div>
        </div>
        <p
          v-else-if="badges.length === 0"
          class="badge-empty"
        >
          Lencana belum dapat dimuat — buka layar Misi lalu coba lagi.
        </p>
        <template v-else>
          <div class="badge-grid">
            <div
              v-for="badge in badges.slice(0, 5)"
              :key="badge.id"
              class="badge-cell"
              :class="{ locked: !badge.earned }"
              :title="badge.description ?? undefined"
            >
              <div class="badge-medal">
                <i
                  class="fas"
                  :class="badge.icon ?? 'fa-award'"
                  aria-hidden="true"
                />
              </div>
              <span>{{ badge.name ?? badge.code }}</span>
            </div>
          </div>
          <button
            class="see-all-btn"
            type="button"
            @click="router.push({ name: 'misi' })"
          >
            Lihat semua lencana
            <i
              class="fas fa-angle-right"
              aria-hidden="true"
            />
          </button>
        </template>
      </div>

      <div class="card">
        <div class="section-head tight">
          <h2>Data Diri</h2>
          <button
            v-if="!editing"
            class="link"
            type="button"
            @click="startEdit"
          >
            <i
              class="fas fa-pencil"
              aria-hidden="true"
            />
            Ubah
          </button>
        </div>

        <form
          v-if="editing"
          novalidate
          @submit.prevent="save"
        >
          <BaseInput
            v-model="editName"
            label="Nama Lengkap"
            type="text"
            autocomplete="name"
            :error="editName.trim().length < 2 ? 'Nama tidak boleh kosong.' : ''"
          />
          <BaseInput
            v-model="editCity"
            label="Kota"
            type="text"
            placeholder="Mis. Bandung"
            hint="Kota membantu misi berbasis lokasi (menyusul)."
          />
          <div class="form-actions">
            <button
              class="btn btn-secondary"
              type="button"
              :disabled="saving"
              @click="editing = false"
            >
              Batal
            </button>
            <button
              class="btn btn-primary"
              type="submit"
              :disabled="saving"
            >
              <span
                v-if="saving"
                class="spinner dark"
                aria-hidden="true"
              />
              <i
                v-else
                class="fas fa-floppy-disk"
                aria-hidden="true"
              />
              Simpan
            </button>
          </div>
        </form>

        <dl
          v-else
          class="detail-list"
        >
          <div>
            <dt>Nama</dt>
            <dd>{{ auth.user?.full_name }}</dd>
          </div>
          <div>
            <dt>Kota</dt>
            <dd>{{ auth.user?.city ?? 'Belum diisi' }}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{{ auth.user?.email ?? '—' }}</dd>
          </div>
        </dl>
      </div>

      <button
        class="btn btn-destructive btn-block logout-btn"
        type="button"
        @click="logout"
      >
        <i
          class="fas fa-arrow-right-from-bracket"
          aria-hidden="true"
        />
        Keluar
      </button>
    </template>
  </main>

  <BottomNav active="profil" />
</template>

<style scoped>
.profile-head {
  display: flex;
  gap: var(--space-4);
  align-items: center;
}
.profile-id h2 {
  font-size: var(--text-lg);
}
.muted {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  margin-bottom: var(--space-2);
}
.profile-stats {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
  text-align: center;
}
.stat strong {
  display: block;
  font-family: var(--font-heading);
  font-size: var(--text-md);
  color: var(--color-primary-strong);
}
.stat span {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
/* Progres level (Sprint 6) */
.level-progress {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--color-border);
}
.level-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--text-xs);
  margin-bottom: var(--space-2);
}
.level-row span {
  color: var(--color-text-muted);
}
.level-row strong {
  color: var(--color-accent-text);
}
/* Statistik dampak (Sprint 6) */
.impact-stats {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  text-align: center;
}
.impact-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.impact-stat i {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
}
.impact-stat strong {
  font-family: var(--font-heading);
  font-size: var(--text-md);
  color: var(--color-primary-strong);
}
.impact-stat span {
  font-size: 10px;
  color: var(--color-text-muted);
}
/* Grid lencana ringkas (pola tab Pencapaian misi.html) */
.badge-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--space-2);
}
.badge-cell {
  text-align: center;
}
.badge-medal {
  width: 48px;
  height: 48px;
  margin: 0 auto 6px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  border: 2px solid transparent;
}
.badge-cell.locked .badge-medal {
  background: var(--surface-alt);
  color: var(--ink-300);
  border-color: var(--line);
}
.badge-cell.locked span {
  opacity: 0.75;
}
.badge-cell span {
  font-size: 9px;
  color: var(--color-text-muted);
  display: block;
}
.badge-cell .sk-circle {
  width: 100%;
  height: 100%;
}
.badge-empty {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  text-align: center;
  padding: var(--space-3);
}
.see-all-btn {
  width: 100%;
  margin-top: var(--space-3);
  border: none;
  background: none;
  cursor: pointer;
  color: var(--color-primary);
  font-weight: 700;
  font-size: var(--text-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 44px;
}
.section-head.tight {
  margin: 0 0 var(--space-3);
}
.link.inline {
  min-height: auto;
  text-decoration: underline;
}
.form-actions {
  display: flex;
  gap: var(--space-3);
}
.form-actions .btn {
  flex: 1;
}
.detail-list div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border);
}
.detail-list div:last-child {
  border-bottom: none;
}
.detail-list dt {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.detail-list dd {
  font-weight: 600;
  text-align: right;
}
.logout-btn {
  margin-top: var(--space-5);
}
</style>
