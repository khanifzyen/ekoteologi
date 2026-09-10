/// <reference path="../pb_data/types.d.ts" />
/**
 * Sprint 10 — bootstrap settings (migrasi, jalan otomatis saat serve):
 *
 *   1. Rate limit (pengganti middleware rate limit Redis FastAPI — PRD §6):
 *      PB rate limiter hanya menghitung SEMUA permintaan per IP (tidak bisa
 *      "hanya gagal" / per email), sehingga nilai login dipilih setara
 *      proteksi brute force tanpa mengunci pengguna sah:
 *        - users:authWithPassword → 30 permintaan / 15 menit / IP
 *          (paritas kasar "5 gagal / 15 menit" lama; guard per-identity
 *          10 percobaan / 15 menit hidup di pb_hooks — lihat main.pb.js)
 *        - users:authRefresh → 60 / menit / IP (auto-refresh klien)
 *        - users:create (guest) → 20 / jam / IP (anti spam registrasi)
 *        - /api/ → 300 / 10 dtk / IP (pelindung global bawaan PB)
 *   2. Meta aplikasi: nama, appURL, pengirim email (untuk template PB).
 *   3. OAuth2 provider Google pada koleksi `users` — dikonfigurasi hanya bila
 *      env GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET terisi (graceful: provider
 *      tidak aktif → klien menampilkan pesan ramah, tanpa error 500).
 *
 * Down migration mengembalikan konfigurasi ke kondisi semula.
 */

migrate(
  (app) => {
    const settings = app.settings()

    // ── 1. rate limits ──
    // Catatan JSVM: cukup objek biasa — di-marshal otomatis ke RateLimitRule.
    settings.rateLimits.enabled = true
    settings.rateLimits.rules = [
      { label: "users:authWithPassword", audience: "", duration: 900, maxRequests: 30 },
      { label: "users:authRefresh", audience: "", duration: 60, maxRequests: 60 },
      { label: "users:create", audience: "", duration: 3600, maxRequests: 20 },
      { label: "/api/", audience: "", duration: 10, maxRequests: 300 },
    ]

    // ── 2. meta aplikasi ──
    settings.meta.appName = $os.getenv("EKO_APP_NAME") || "Ekoteologi AR"
    const appUrl = $os.getenv("EKO_APP_URL")
    if (appUrl) {
      settings.meta.appURL = appUrl
    }
    settings.meta.senderName = "Ekoteologi"
    settings.meta.senderAddress = $os.getenv("EKO_SENDER_EMAIL") || "no-reply@ekoteologi.id"
    app.save(settings)

    // ── 2b. autodate created/updated utk seluruh koleksi ──
    // Temuan v0.40: koleksi bawaan TIDAK lagi menyertakan autodate created/
    // updated, dan skema port sprint 9 (deklarasi field eksplisit) ikut tanpa
    // keduanya — padahal klien (riwayat, notif, admin "terdaftar", sort
    // terbaru) memakai timestamp. Tambahkan ke semua koleksi non-sistem.
    const SYSTEM_PREFIX = "_"
    const allCols = app.findAllCollections() || []
    for (let ci = 0; ci < allCols.length; ci++) {
      const col = allCols[ci]
      if (!col || col.system || (col.name || "").indexOf(SYSTEM_PREFIX) === 0) continue
      // Gunakan kelas Field + fields.add() — push objek biasa ke array
      // `col.fields` gagal konversi Go ("could not convert to core.Field").
      if (!(col.fields.getByName && col.fields.getByName("created"))) {
        col.fields.add(new AutodateField({ name: "created", onCreate: true, onSystemCreate: true }))
      }
      if (!(col.fields.getByName && col.fields.getByName("updated"))) {
        col.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true, onSystemCreate: true }))
      }
      app.save(col)
    }

    // ── 3. OAuth2 Google (kondisional via env) ──
    // mappedFields = field RECORD tujuan: nama provider → `full_name` (bukan
    // `name` — koleksi users kita tidak punya field itu, dan full_name
    // required); username dinonaktifkan (tidak ada field); avatarURL juga —
    // field `avatar` bertipe FILE, URL provider tak bisa disimpan ke sana
    // (pengguna OAuth bisa mengunggah avatar sendiri via profil).
    const clientId = $os.getenv("GOOGLE_CLIENT_ID")
    const clientSecret = $os.getenv("GOOGLE_CLIENT_SECRET")
    if (clientId && clientSecret) {
      const users = app.findCollectionByNameOrId("users")
      users.oauth2.enabled = true
      users.oauth2.mappedFields.name = "full_name"
      users.oauth2.mappedFields.username = ""
      users.oauth2.mappedFields.avatarURL = ""
      users.oauth2.providers = [
        {
          type: "google",
          name: "google",
          clientId: clientId,
          clientSecret: clientSecret,
        },
      ]
      app.save(users)
    }
  },
  (app) => {
    // down — matikan rate limit & hapus provider google (skema koleksi utuh).
    const settings = app.settings()
    settings.rateLimits.enabled = false
    settings.rateLimits.rules = []
    app.save(settings)

    try {
      const users = app.findCollectionByNameOrId("users")
      if (users.oauth2.enabled) {
        users.oauth2.enabled = false
        users.oauth2.providers = []
        app.save(users)
      }
    } catch (_) {
      /* koleksi users sudah tidak ada (down schema) — abaikan */
    }
  }
)
