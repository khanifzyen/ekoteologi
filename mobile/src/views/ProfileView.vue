<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, apiUrl } from '@/api/client'
import BottomNav from '@/components/layout/BottomNav.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import StateError from '@/components/state/StateError.vue'
import StateSkeleton from '@/components/state/StateSkeleton.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

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
  } catch (err) {
    state.value = 'error'
    if (err instanceof ApiError && err.status !== 0) toast.show(err.message)
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
            <strong>{{ auth.user?.points ?? 0 }}</strong>
            <span>Poin</span>
          </div>
          <div class="stat">
            <strong>{{ auth.user?.city ?? '—' }}</strong>
            <span>Kota</span>
          </div>
          <div class="stat">
            <strong>{{ auth.profile?.level ?? 1 }}</strong>
            <span>Level</span>
          </div>
        </div>
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
