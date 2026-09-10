/**
 * Google Sign-In → OAuth2 provider Google PocketBase (Sprint 10).
 *
 * Dua jalur, keduanya berakhir di `authWithOAuth2(Code)` milik SDK sehingga
 * auth store aplikasi terisi sama dengan alur email+kata sandi:
 *
 * - NATIVE (Capacitor/Android): system browser via `@capacitor/browser`,
 *   kembali ke aplikasi lewat deep link custom scheme yang ditangkap
 *   `@capacitor/app` (`appUrlOpen`), lalu tukar kode via
 *   `authWithOAuth2Code` (PKCE S256). Redirect URI diambil dari env
 *   `VITE_GOOGLE_OAUTH_REDIRECT` (mis. `id.ekoteologi.app://oauth/callback`)
 *   dan wajib didaftarkan di Google Cloud Console.
 * - WEB: popup bawaan SDK `authWithOAuth2({ provider: 'google' })` dengan
 *   redirect `https://<host>/api/oauth2-redirect`.
 *
 * Prasyarat server: provider `google` aktif di koleksi `users` (migrasi
 * settings bootstrap mengaktifkannya bila env GOOGLE_CLIENT_ID/SECRET terisi).
 * Bila belum dikonfigurasi, tombol memberi pesan ramah (DoD microcopy) dan
 * alur email+kata sandi tetap jalan.
 */
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import type { ClientResponseError } from 'pocketbase'

import { pb } from '@/api/client'

export class GoogleSignInUnavailableError extends Error {}

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_SCOPE = 'openid email profile'

/** Provider google aktif di server? (cek `listAuthMethods` — tanpa asumsi.) */
async function googleProviderEnabled(): Promise<boolean> {
  try {
    const methods = await pb.collection('users').listAuthMethods()
    return (methods.oauth2?.providers ?? []).some((p) => p.name === 'google')
  } catch {
    return false
  }
}

function clientWebId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
}

function nativeRedirect(): string {
  return import.meta.env.VITE_GOOGLE_OAUTH_REDIRECT ?? ''
}

function throwUnavailable(detail?: string): never {
  throw new GoogleSignInUnavailableError(
    detail ??
      'Masuk dengan Google belum diaktifkan. Gunakan email dan kata sandi.',
  )
}

/** PKCE S256 — verifier acak 64 char + challenge base64url(sha256(verifier)). */
async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const verifier = base64Url(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64Url(new Uint8Array(digest))
  return { verifier, challenge }
}

function base64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Cegah injeksi deep link: state acak wajib sama. */
function randomState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

/** Masuk dengan Google; resolve setelah auth store SDK terisi. */
export async function signInWithGoogle(): Promise<void> {
  if (!(await googleProviderEnabled())) {
    throwUnavailable()
  }
  if (Capacitor.isNativePlatform()) {
    return nativeFlow()
  }
  return webFlow()
}

async function webFlow(): Promise<void> {
  if (!clientWebId()) {
    // Popup SDK memakai konfigurasi provider di server; client id env hanya
    // validasi cepat agar tidak membuka popup pasti-gagal.
    throwUnavailable()
  }
  try {
    await pb.collection('users').authWithOAuth2({ provider: 'google' })
  } catch (err) {
    // Popup ditutup pengguna → sampaikan tenang; error lain diteruskan.
    const message = (err as Error)?.message ?? ''
    if (/popup|dismiss|closed|cancelled/i.test(message)) {
      throw new GoogleSignInUnavailableError('Masuk dengan Google dibatalkan.')
    }
    throw new GoogleSignInUnavailableError(
      'Masuk dengan Google gagal. Coba lagi atau gunakan email.',
    )
  }
}

async function nativeFlow(): Promise<void> {
  const redirectUrl = nativeRedirect()
  if (!redirectUrl || !clientWebId()) {
    throwUnavailable(
      'Masuk dengan Google belum dikonfigurasi untuk perangkat ini. Gunakan email dan kata sandi.',
    )
  }
  const state = randomState()
  const { verifier, challenge } = await createPkce()
  const url =
    `${GOOGLE_AUTH_ENDPOINT}?client_id=${encodeURIComponent(clientWebId())}` +
    `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
    `&response_type=code&scope=${encodeURIComponent(GOOGLE_SCOPE)}` +
    `&state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`

  // Tangkap deep link SEBELUM browser dibuka (hindari balapan saat kembali).
  const resolved = await new Promise<string>((resolve, reject) => {
    let done = false
    void App.addListener('appUrlOpen', (event) => {
      if (done) return
      done = true
      void Browser.close().catch(() => {})
      try {
        const opened = new URL(event.url)
        if (opened.searchParams.get('state') !== state) {
          reject(new GoogleSignInUnavailableError('Sesi Google tidak valid. Coba lagi.'))
          return
        }
        const code = opened.searchParams.get('code')
        if (!code) {
          reject(new GoogleSignInUnavailableError('Masuk dengan Google dibatalkan.'))
          return
        }
        resolve(code)
      } catch {
        reject(new GoogleSignInUnavailableError('Masuk dengan Google dibatalkan.'))
      }
    })
    void Browser.open({ url }).catch((err) => {
      if (!done) {
        done = true
        reject(new GoogleSignInUnavailableError('Browser tidak dapat dibuka di perangkat ini.'))
        throw err
      }
    })
  })

  try {
    // createData memastikan field required terisi walau nama provider kosong.
    await pb.collection('users').authWithOAuth2Code('google', resolved, verifier, redirectUrl, {
      role: 'user',
    })
  } catch (err) {
    const pbErr = err as ClientResponseError
    if (pbErr?.status === 0) throw pbErr // biarkan toko offline menangani
    throw new GoogleSignInUnavailableError(
      'Masuk dengan Google gagal. Coba lagi atau gunakan email.',
    )
  }
}
