/// <reference path="../pb_data/types.d.ts" />
// Ekoteologi AR — hook JSVM (sprint 9: fondasi).
//
// Isi sprint 9:
//   1. GET /api/ekoteologi/ping — route kustom pertama, dipakai smoke CI/lokal.
//   2. Guard update `users` — updateRule tidak bisa membandingkan nilai lama vs
//      baru, sehingga user biasa berpotensi menaikkan sendiri `role`/`points`/
//      `is_active`/streak lewat PATCH profil. Hook ini menolak perubahan field
//      terjaga bila aktor bukan admin/superuser (pelengkap default deny —
//      pengganti require_roles).
//
// Konvensi: route kustom berprefix /api/ekoteologi/* (kontrak di README.md).
// Catatan JSVM: komentar dibersihkan PB saat memuat file — hindari blok komentar
// berformat khusus dan pertahankan kode sederhana.

routerAdd("GET", "/api/ekoteologi/ping", (e) => {
  return e.json(200, {
    name: $os.getenv("EKO_APP_NAME") || "ekoteologi-backend",
    version: $os.getenv("EKO_APP_VERSION") || "0.1.0-sprint9",
    time: new Date().toISOString(),
  })
})

// Normalisasi saat create `users`: role kosong -> "user" (PB tak punya default
// field), is_active selalu true saat pendaftaran (paritas skema lama).
onRecordCreateRequest((e) => {
  if (e.record.get("role") === "") {
    e.record.set("role", "user")
  }
  e.record.set("is_active", true)
  return e.next()
}, "users")

onRecordUpdateRequest((e) => {
  const auth = e.auth
  if (!auth) {
    throw new ApiError(403, "Butuh autentikasi.")
  }
  const isSuperuser = auth.collection().name === "_superusers"
  const isAdmin = auth.get("role") === "admin"
  if (isSuperuser || isAdmin) {
    return e.next()
  }

  // Tolak bila request mencoba MENGIRIM field terjaga — cek body, bukan
  // perbandingan nilai (field tak tersentuh bisa berubah representasi tipe
  // setelah form.Load).
  const body = e.requestInfo().body || {}
  const keys = Object.keys(body)
  const guarded = ["role", "points", "is_active", "current_streak", "longest_streak", "last_active_date"]
  for (let i = 0; i < guarded.length; i++) {
    if (keys.indexOf(guarded[i]) !== -1) {
      throw new ApiError(403, "Field " + guarded[i] + " hanya boleh diubah admin.")
    }
  }
  return e.next()
}, "users")
