<script setup lang="ts">
const { title = '', sub = '', noBody = false } = defineProps<{
  title?: string
  sub?: string
  /** Render slot langsung tanpa .panel-body (mis. untuk tabel full-bleed). */
  noBody?: boolean
}>()
</script>

<template>
  <div class="panel">
    <div
      v-if="title || $slots.actions"
      class="panel-head"
    >
      <div>
        <h2>{{ title }}</h2>
        <div
          v-if="sub"
          class="sub"
        >
          {{ sub }}
        </div>
      </div>
      <slot name="actions" />
    </div>
    <div
      v-if="!noBody"
      class="panel-body"
    >
      <slot />
    </div>
    <slot v-else />
  </div>
</template>
