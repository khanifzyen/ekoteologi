<script setup lang="ts">
const { variant = 'primary', size = 'md', block = false, type = 'button' } = defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'gold'
  size?: 'md' | 'sm'
  block?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
}>()
</script>

<template>
  <button
    class="btn"
    :class="[`btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block']"
    :type="type"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>
