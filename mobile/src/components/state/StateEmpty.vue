<script setup lang="ts">
withDefaults(
  defineProps<{
    icon?: string
    title: string
    text?: string
  }>(),
  { icon: 'fa-inbox', text: '' },
)
</script>

<template>
  <div class="empty">
    <div class="empty-icon">
      <i
        class="fas"
        :class="icon"
        aria-hidden="true"
      />
    </div>
    <h3>{{ title }}</h3>
    <p v-if="text">
      {{ text }}
    </p>
    <slot />
  </div>
</template>
