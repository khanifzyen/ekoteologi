/**
 * Service push FCM (Sprint 6 → Sprint 10: koleksi `fcm_tokens` PocketBase).
 *
 * Pendaftaran token sisi klien: saat aplikasi berjalan NATIVE (Android/APK),
 * izin notifikasi diminta dan token hasil `registration` disimpan sebagai
 * record `fcm_tokens` milik user (unique index token → duplikat diabaikan).
 * Pengiriman push dari server (FCM HTTP v1 via hook) menyusul Sprint 13.
 */

import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

import { currentUserId, pb } from '@/api/client'

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
        pb.collection('fcm_tokens')
          .create({
            user: currentUserId(),
            token: token.value,
            // platform token lama ("android"/"ios"/"web") — cukup keterangan.
            platform: Capacitor.getPlatform(),
          })
          .then(() => settle(true))
          .catch(() => settle(true)) // token sudah terdaftar (unique) = sukses
      })
      PushNotifications.addListener('registrationError', () => settle(false))
      PushNotifications.register()
    })
    return { attempted: true, granted: registered }
  } catch {
    return { attempted: true, granted: false }
  }
}
