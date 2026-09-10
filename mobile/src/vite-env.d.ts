/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL dasar backend PocketBase, mis. http://127.0.0.1:8090 */
  readonly VITE_PB_URL?: string
  /** OAuth Client ID Google (web) — opsional */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** Redirect URI native (custom scheme) untuk alur OAuth2 Google — opsional */
  readonly VITE_GOOGLE_OAUTH_REDIRECT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
