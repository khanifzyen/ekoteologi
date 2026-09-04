<script setup lang="ts">
import { computed, ref, useId } from 'vue'

const model = defineModel<string>({ default: '' })

const {
  label = '',
  type = 'text',
  placeholder = '',
  hint = '',
  error = '',
  autocomplete = '',
  required = false,
} = defineProps<{
  label?: string
  type?: 'text' | 'email' | 'password' | 'search' | 'number' | 'date'
  placeholder?: string
  hint?: string
  error?: string
  autocomplete?: string
  required?: boolean
}>()

const showPassword = ref(false)
const actualType = computed(() => (type === 'password' && showPassword.value ? 'text' : type))
const invalid = computed(() => error !== '')
const inputId = useId()
</script>

<template>
  <div
    class="field"
    :class="{ invalid }"
  >
    <label
      v-if="label"
      class="label"
      :for="inputId"
    >{{ label }}</label>
    <div class="input-wrap">
      <input
        :id="inputId"
        v-model="model"
        class="input"
        :type="actualType"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :required="required"
        :aria-invalid="invalid || undefined"
        :aria-describedby="invalid ? `${inputId}-error` : undefined"
      >
      <button
        v-if="type === 'password'"
        class="inside-btn"
        type="button"
        :aria-label="showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'"
        @click="showPassword = !showPassword"
      >
        <i
          class="fas"
          :class="showPassword ? 'fa-eye-slash' : 'fa-eye'"
          aria-hidden="true"
        />
      </button>
    </div>
    <p
      v-if="error"
      :id="`${inputId}-error`"
      class="field-error"
    >
      {{ error }}
    </p>
    <p
      v-else-if="hint"
      class="hint"
    >
      {{ hint }}
    </p>
  </div>
</template>
