<script setup lang="ts">
export interface TabOption {
  value: string
  label: string
}

defineProps<{
  options: TabOption[]
}>()

const model = defineModel<string>({ default: '' })
</script>

<template>
  <div
    class="tabs"
    role="tablist"
  >
    <button
      v-for="option in options"
      :key="option.value"
      class="tab-btn"
      :class="{ active: model === option.value }"
      role="tab"
      type="button"
      :aria-selected="model === option.value"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
