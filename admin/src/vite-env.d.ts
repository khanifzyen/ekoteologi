/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL dasar backend PocketBase, mis. http://127.0.0.1:8090 */
  readonly VITE_PB_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
