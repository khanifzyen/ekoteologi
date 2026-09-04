<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError } from '@/api/client'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { GoogleSignInUnavailableError, signInWithGoogle } from '@/services/googleAuth'

const router = useRouter()
const toast = useToastStore()
const auth = useAuthStore()

type Mode = 'login' | 'daftar'
const mode = ref<Mode>('login')

const email = ref('')
const password = ref('')
const remember = ref(true)
const fullName = ref('')
const agree = ref(false)

const fieldError = ref<{ email?: string; password?: string; fullName?: string }>({})
const formError = ref('')
const busy = ref(false)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function setMode(next: Mode) {
  mode.value = next
  formError.value = ''
  fieldError.value = {}
}

function validateLogin(): boolean {
  const errors: typeof fieldError.value = {}
  if (!EMAIL_RE.test(email.value.trim())) errors.email = 'Masukkan alamat email yang valid.'
  if (password.value.length < 8) errors.password = 'Kata sandi minimal 8 karakter.'
  fieldError.value = errors
  return Object.keys(errors).length === 0
}

function validateRegister(): boolean {
  const errors: typeof fieldError.value = {}
  if (fullName.value.trim().length < 2) errors.fullName = 'Nama tidak boleh kosong.'
  if (!EMAIL_RE.test(email.value.trim())) errors.email = 'Masukkan alamat email yang valid.'
  if (password.value.length < 8) errors.password = 'Kata sandi minimal 8 karakter.'
  fieldError.value = errors
  return Object.keys(errors).length === 0
}

async function submit() {
  formError.value = ''
  const isLogin = mode.value === 'login'
  if (isLogin ? !validateLogin() : !validateRegister()) return
  if (!isLogin && !agree.value) {
    toast.show('Centang persetujuan Syarat & Ketentuan dulu, ya.')
    return
  }

  busy.value = true
  try {
    if (isLogin) {
      await auth.login(email.value.trim(), password.value, remember.value)
      toast.show('Alhamdulillah, berhasil masuk!')
    } else {
      await auth.register(fullName.value.trim(), email.value.trim(), password.value)
      toast.show('Akun berhasil dibuat. Selamat datang!')
    }
    await router.replace({ name: 'home' })
  } catch (err) {
    formError.value = pesanKesalahan(err)
  } finally {
    busy.value = false
  }
}

function pesanKesalahan(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Tidak dapat terhubung ke server. Periksa koneksi Anda.'
    return err.message
  }
  return 'Terjadi kesalahan yang tidak terduga. Coba lagi.'
}

async function onGoogle() {
  try {
    await signInWithGoogle()
  } catch (err) {
    const message =
      err instanceof GoogleSignInUnavailableError
        ? err.message
        : 'Masuk dengan Google gagal. Coba lagi.'
    toast.show(message)
  }
}
</script>

<template>
  <!-- Header melengkung kecil (mockup auth.html) -->
  <header class="header-curved auth-header">
    <div class="auth-logo">
      <i
        class="fas fa-seedling"
        aria-hidden="true"
      />
    </div>
    <h1>Selamat Datang</h1>
    <p>Jaga bumi, jaga iman — mulai dari kebiasaan kecil.</p>
  </header>

  <main class="content-overlap">
    <div class="card auth-card">
      <!-- Toggle Masuk / Daftar -->
      <div
        class="seg"
        role="tablist"
        aria-label="Pilih mode"
      >
        <button
          role="tab"
          type="button"
          :aria-selected="mode === 'login'"
          @click="setMode('login')"
        >
          Masuk
        </button>
        <button
          role="tab"
          type="button"
          :aria-selected="mode === 'daftar'"
          @click="setMode('daftar')"
        >
          Daftar
        </button>
      </div>

      <div
        v-if="formError"
        class="auth-error"
        role="alert"
      >
        <i
          class="fas fa-circle-exclamation"
          aria-hidden="true"
        />
        {{ formError }}
      </div>

      <!-- ═══ FORM MASUK ═══ -->
      <form
        v-if="mode === 'login'"
        novalidate
        @submit.prevent="submit"
      >
        <BaseInput
          v-model="email"
          label="Email"
          type="email"
          autocomplete="email"
          inputmode="email"
          placeholder="nama@email.com"
          :error="fieldError.email"
        />
        <BaseInput
          v-model="password"
          label="Kata Sandi"
          type="password"
          autocomplete="current-password"
          placeholder="Minimal 8 karakter"
          :error="fieldError.password"
        />

        <div class="form-row">
          <label class="check">
            <input
              v-model="remember"
              type="checkbox"
            >
            Ingat saya
          </label>
          <a
            class="link"
            href="#"
            @click.prevent="toast.show('Fitur atur ulang kata sandi menyusul.')"
          >Lupa kata sandi?</a>
        </div>

        <button
          class="btn btn-primary btn-block"
          type="submit"
          :disabled="busy"
        >
          <span
            v-if="busy"
            class="spinner"
            aria-hidden="true"
          />
          <i
            v-else
            class="fas fa-arrow-right-to-bracket"
            aria-hidden="true"
          />
          {{ busy ? 'Memproses…' : 'Masuk' }}
        </button>

        <div class="divider">
          atau masuk dengan
        </div>

        <button
          class="btn-google"
          type="button"
          @click="onGoogle"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 48 48"
            aria-hidden="true"
          ><path
            fill="#FFC107"
            d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"
          /><path
            fill="#FF3D00"
            d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
          /><path
            fill="#4CAF50"
            d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
          /><path
            fill="#1976D2"
            d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"
          /></svg>
          Lanjut dengan Google
        </button>

        <p class="auth-foot">
          Belum punya akun?
          <a
            class="link"
            href="#"
            @click.prevent="setMode('daftar')"
          >Daftar sekarang</a>
        </p>
      </form>

      <!-- ═══ FORM DAFTAR ═══ -->
      <form
        v-else
        novalidate
        @submit.prevent="submit"
      >
        <BaseInput
          v-model="fullName"
          label="Nama Lengkap"
          type="text"
          autocomplete="name"
          placeholder="Nama kamu"
          :error="fieldError.fullName"
        />
        <BaseInput
          v-model="email"
          label="Email"
          type="email"
          autocomplete="email"
          inputmode="email"
          placeholder="nama@email.com"
          :error="fieldError.email"
        />
        <BaseInput
          v-model="password"
          label="Kata Sandi"
          type="password"
          autocomplete="new-password"
          placeholder="Minimal 8 karakter"
          :error="fieldError.password"
        />

        <label class="check agree">
          <input
            v-model="agree"
            type="checkbox"
          >
          <span>Saya setuju
            <a
              class="link inline"
              href="#"
              @click.prevent="toast.show('Syarat & Ketentuan menyusul.')"
            >Syarat &amp; Ketentuan</a>
            serta
            <a
              class="link inline"
              href="#"
              @click.prevent="toast.show('Kebijakan Privasi menyusul.')"
            >Kebijakan Privasi</a></span>
        </label>

        <button
          class="btn btn-primary btn-block"
          type="submit"
          :disabled="busy"
        >
          <span
            v-if="busy"
            class="spinner"
            aria-hidden="true"
          />
          <i
            v-else
            class="fas fa-user-plus"
            aria-hidden="true"
          />
          {{ busy ? 'Mendaftarkan…' : 'Buat Akun' }}
        </button>

        <p class="auth-foot">
          Sudah punya akun?
          <a
            class="link"
            href="#"
            @click.prevent="setMode('login')"
          >Masuk</a>
        </p>
      </form>
    </div>
  </main>
</template>
