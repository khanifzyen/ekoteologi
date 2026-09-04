import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ToastMessage {
  id: number
  text: string
}

export const useToastStore = defineStore('toast', () => {
  const current = ref<ToastMessage | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  function show(text: string, durationMs = 3000) {
    current.value = { id: ++seq, text }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (current.value = null), durationMs)
  }

  return { current, show }
})
