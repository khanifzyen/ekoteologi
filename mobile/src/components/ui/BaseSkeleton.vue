<script setup lang="ts">
const { variant = 'line' } = defineProps<{
  variant?: 'line' | 'circle'
}>()
</script>

<template>
  <div
    class="skeleton"
    :class="variant === 'circle' && 'sk-circle'"
    aria-hidden="true"
  />
</template>
