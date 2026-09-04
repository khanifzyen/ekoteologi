<script setup lang="ts">
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
</script>

<template>
  <div
    class="toast"
    :class="{ show: toast.current }"
    role="status"
    aria-live="polite"
  >
    {{ toast.current?.text }}
  </div>
</template>
