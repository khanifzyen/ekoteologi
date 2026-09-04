/**
 * Adapter Google Sign-In (Sprint 1).
 *
 * Endpoint API `POST /v1/auth/google` sudah siap menerima ID token. Sisi
 * klien native menunggu dua prasyarat eksternal:
 *  1. OAuth Client ID (Google Cloud Console) via env `VITE_GOOGLE_CLIENT_ID`
 *     dan `GOOGLE_CLIENT_ID` di API (implementation-plan §2.2).
 *  2. Plugin Capacitor yang kompatibel dengan Capacitor 8 — plugin komunitas
 *     `@codetrix-studio/capacitor-google-auth` masih peer-depends Capacitor 6.
 *
 * Sementara itu tombol Google di layar masuk memberi pesan jelas (DoD
 * microcopy) dan tidak menggagalkan alur email+kata sandi.
 */

export class GoogleSignInUnavailableError extends Error {}

export function googleSignInConfigured(): boolean {
  return Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
}

export async function signInWithGoogle(): Promise<string> {
  if (!googleSignInConfigured()) {
    throw new GoogleSignInUnavailableError(
      'Masuk dengan Google belum diaktifkan. Gunakan email dan kata sandi.',
    )
  }
  // Branch native akan memanggil plugin GoogleAuth.signIn() setelah plugin
  // kompatibel Capacitor 8 dipasang; lihat catatan di atas.
  throw new GoogleSignInUnavailableError(
    'Masuk dengan Google di perangkat belum tersedia di build ini.',
  )
}
