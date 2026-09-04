<script setup lang="ts">
import { RouterView } from 'vue-router'

import ToastHost from '@/components/ui/ToastHost.vue'
</script>

<template>
  <div class="app">
    <RouterView />
    <ToastHost />
  </div>
</template>
