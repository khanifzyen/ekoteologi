<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Pesan kesalahan; bila kosong, dipakai pesan default. */
    message?: string
    /** Sembunyikan tombol coba lagi (mis. kesalahan permanen). */
    retryable?: boolean
  }>(),
  { message: 'Terjadi kesalahan saat memuat data.', retryable: true },
)

defineEmits<{ retry: [] }>()
</script>

<template>
  <div
    class="error-box"
    role="alert"
  >
    <i
      class="fas fa-triangle-exclamation"
      aria-hidden="true"
    />
    <p>{{ message }}</p>
    <button
      v-if="retryable"
      class="btn btn-secondary btn-sm"
      type="button"
      @click="$emit('retry')"
    >
      <i
        class="fas fa-rotate-right"
        aria-hidden="true"
      />
      Coba Lagi
    </button>
  </div>
</template>
