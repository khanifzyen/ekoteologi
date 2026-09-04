<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'

import OfflineBar from '@/components/state/OfflineBar.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

// Pulihkan sesi dari penyimpanan lokal (verifikasi token via /v1/profile).
onMounted(() => auth.restoreSession())
</script>

<template>
  <div class="app">
    <OfflineBar />
    <RouterView />
    <ToastHost />
  </div>
</template>
