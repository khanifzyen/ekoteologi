<script setup lang="ts">
defineProps<{
  /** aria-label bila kartu punya makna khusus bagi pembaca layar. */
  ariaLabel?: string
}>()
</script>

<template>
  <div
    class="card"
    :aria-label="ariaLabel"
  >
    <slot />
  </div>
</template>
