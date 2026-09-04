/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL dasar API FastAPI, mis. http://localhost:8100 */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
