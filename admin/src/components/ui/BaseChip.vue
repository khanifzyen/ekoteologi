<script setup lang="ts">
const { variant = 'user' } = defineProps<{
  variant?: 'admin' | 'verifier' | 'editor' | 'user' | 'active' | 'blocked' | 'pending'
}>()
</script>

<template>
  <span
    class="badge"
    :class="`badge-${variant}`"
  ><slot /></span>
</template>
