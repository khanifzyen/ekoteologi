import { onMounted, onUnmounted, ref, type Ref } from 'vue'

/** Status koneksi browser/WebView — menggerakkan OfflineBar. */
export function useOnline(target?: Ref<boolean>): Ref<boolean> {
  const online = target ?? ref(navigator.onLine)

  function update() {
    online.value = navigator.onLine
  }

  onMounted(() => {
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
  })
  onUnmounted(() => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })

  return online
}
