<script setup lang="ts">
import { ref } from 'vue'

import { useOnline } from '@/composables/useOnline'

const online = useOnline(ref(navigator.onLine))
</script>

<template>
  <div
    class="offline-bar"
    :class="{ show: !online }"
    role="status"
  >
    <i
      class="fas fa-wifi"
      aria-hidden="true"
    />
    Anda sedang luring — perubahan tidak akan tersimpan.
  </div>
</template>
