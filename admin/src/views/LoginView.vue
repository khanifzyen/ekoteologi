<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const errorMessage = ref('')
const busy = ref(false)

// computed: komponen bisa di-reuse saat query berubah (mis. redirect dari role guard).
const forbidden = computed(() => route.query.error === 'forbidden')

async function onSubmit() {
  errorMessage.value = ''
  if (!email.value || !password.value) {
    errorMessage.value = 'Email dan kata sandi wajib diisi.'
    return
  }
  busy.value = true
  try {
    await auth.login(email.value, password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    router.replace(redirect)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Gagal masuk. Silakan coba lagi.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <div class="auth-card">
      <div class="auth-brand">
        <div class="mark">
          <i
            class="fas fa-seedling"
            aria-hidden="true"
          />
        </div>
        <div>
          <h1>Ekoteologi AR</h1>
          <span>Panel Admin</span>
        </div>
      </div>

      <div class="panel">
        <div class="panel-body">
          <div
            v-if="forbidden"
            class="error-box"
            role="alert"
          >
            <i
              class="fas fa-circle-exclamation"
              aria-hidden="true"
            />
            <p>Akun Anda tidak memiliki akses ke panel admin.</p>
          </div>

          <form
            novalidate
            @submit.prevent="onSubmit"
          >
            <BaseInput
              v-model="email"
              type="email"
              label="Email"
              placeholder="nama@ekoteologi.id"
              autocomplete="username"
              required
            />
            <BaseInput
              v-model="password"
              type="password"
              label="Kata Sandi"
              placeholder="Masukkan kata sandi"
              autocomplete="current-password"
              required
            />
            <div
              v-if="errorMessage"
              class="error-box"
              role="alert"
            >
              <i
                class="fas fa-circle-exclamation"
                aria-hidden="true"
              />
              <p>{{ errorMessage }}</p>
            </div>
            <BaseButton
              type="submit"
              block
              :disabled="busy"
            >
              <i
                v-if="busy"
                class="fas fa-spinner fa-spin"
                aria-hidden="true"
              />
              {{ busy ? 'Memproses…' : 'Masuk' }}
            </BaseButton>
          </form>
        </div>
      </div>
      <p class="auth-foot">
        Akses khusus admin, verifier, dan editor.
      </p>
    </div>
  </main>
</template>
