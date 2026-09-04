/**
 * Service push FCM (Sprint 6) — daftarkan token perangkat ke API (`fcm_tokens`).
 *
 * Kredensial FCM server masih item terbuka (laporan Sprint 6), tapi pendaftaran
 * token sisi klien sudah lengkap: saat aplikasi berjalan NATIVE (Android/APK),
 * izin notifikasi diminta dan token hasil `registration` dikirim ke
 * `POST /v1/push/token`. Di browser (dev web) pendaftaran di-skip — FCM butuh
 * build native; tidak ada error yang tampil ke pengguna (best-effort).
 */

import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

import { api } from '@/api/client'

/** Sekali per sesi aplikasi — gagal pun tak diulang (tak memblokir UI). */
let attempted = false

export interface RegisterResult {
  attempted: boolean
  granted: boolean
}

export async function registerPush(): Promise<RegisterResult> {
  if (attempted) return { attempted: false, granted: false }
  attempted = true
  if (!Capacitor.isNativePlatform()) {
    return { attempted: false, granted: false } // browser dev — FCM butuh APK
  }
  try {
    const status = await PushNotifications.checkPermissions()
    if (status.receive !== 'granted') {
      const requested = await PushNotifications.requestPermissions()
      if (requested.receive !== 'granted') return { attempted: true, granted: false }
    }
    const registered = await new Promise<boolean>((resolve) => {
      let settled = false
      // Token kadang molor — 15 dtk cukup; gagal saja, tidak memblokir UI.
      const timeout = setTimeout(() => settle(false), 15_000)
      function settle(value: boolean) {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(value)
      }
      PushNotifications.addListener('registration', (token) => {
        api('/v1/push/token', {
          method: 'POST',
          body: { token: token.value, platform: Capacitor.getPlatform() },
        })
          .then(() => settle(true))
          .catch(() => settle(false))
      })
      PushNotifications.addListener('registrationError', () => settle(false))
      PushNotifications.register()
    })
    return { attempted: true, granted: registered }
  } catch {
    return { attempted: true, granted: false }
  }
}
