import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts'],
    // vue-tsc --noEmit typecheck tidak perlu memproses file test
    typecheck: { enabled: false },
  },
})
