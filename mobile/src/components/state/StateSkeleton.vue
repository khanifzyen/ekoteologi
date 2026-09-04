<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Jumlah kartu skeleton yang ditampilkan. */
    rows?: number
  }>(),
  { rows: 2 },
)
</script>

<template>
  <div
    v-for="row in rows"
    :key="row"
    class="sk-card"
    aria-hidden="true"
  >
    <div class="skeleton sk-circle" />
    <div class="sk-lines">
      <div class="skeleton" />
      <div
        class="skeleton"
        style="min-height: 14px; width: 70%"
      />
    </div>
  </div>
</template>
