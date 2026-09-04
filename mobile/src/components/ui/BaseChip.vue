<script setup lang="ts">
const { variant = 'muted' } = defineProps<{
  variant?: 'gold' | 'green' | 'danger' | 'info' | 'muted'
}>()
</script>

<template>
  <span
    class="chip"
    :class="`chip-${variant}`"
  ><slot /></span>
</template>
