/** Status consent penggunaan foto (PRD §9) — disimpan lokal per perangkat.

Catatan Sprint 3: consent scan disimpan di localStorage dan dipakai sebagai
prasyarat unggah foto scan. Pencatatan consent di sisi server + retensi/
penghapusan bukti misi menyusul Sprint 4 (keputusan terbuka PRD §6 #6).
*/

const KEY = 'ekoteologi_consent_foto'

export function hasFotoConsent(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    if (raw === '1') return true // format awal sebelum ada timestamp
    const parsed = JSON.parse(raw) as { granted?: number }
    return parsed?.granted === 1
  } catch {
    return false
  }
}

export function grantFotoConsent(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ granted: 1, at: new Date().toISOString() }))
  } catch {
    /* penyimpanan tidak tersedia — consent hanya berlaku di sesi ini */
  }
}
