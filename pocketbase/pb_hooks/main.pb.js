/// <reference path="../pb_data/types.d.ts" />
// Ekoteologi AR — hook JSVM.
//
// Sprint 9 (fondasi):
//   1. GET /api/ekoteologi/ping — route kustom, dipakai smoke CI/lokal.
//   2. Guard update `users` — updateRule tidak bisa membandingkan nilai lama
//      vs baru, sehingga user biasa berpotensi menaikkan sendiri `role`/
//      `points`/`is_active`/streak lewat PATCH profil (pengganti require_roles).
// Sprint 10 (auth, profil & audit):
//   3. Audit log — onRecord{Create,Update,Delete}Request + onRecordAuthRequest
//      → koleksi `audit_logs` (pengganti middleware audit FastAPI; tulis
//      konteks sistem, baca admin).
//   4. Guard login per-identitas — 10 percobaan / 15 menit / email (sukses
//      mereset) di koleksi app_settings; pelengkap rate limit settings
//      per-IP dari migrasi settings bootstrap.
// Sprint 11 (scan AI & ledger): route scan/quota/stats + hook ledger
//   `point_transactions` hidup di scan.pb.js (lihat header file itu).
// Sprint 12 (misi, verifikasi & gamifikasi): route klaim/badges/streak,
//   engine review, level/streak/badge, cron reminder — gamification.pb.js.
// Sprint 13 (e-learning, notifikasi, ops): route modul/lesson/kuis server-
//   side + konten harian — elearning.pb.js; pipeline notifikasi realtime→
//   push FCM + broadcast admin — push.pb.js; dashboard agregasi, cleanup,
//   backup manual, error hook Sentry — ops.pb.js.
//
// PENTING — batasan JSVM v0.40 (plugins/jsvm binds.go, terverifikasi):
// handler hook dikirim ke Go sebagai SUMBER fungsi (stringify) lalu
// dikompilasi & dijalankan ulang di executor VM pool. Closure atas const/
// fungsi top-level file TIDAK terbawa, dan globalThis loader tidak terlihat.
// Konsekuensi:
//   - setiap handler WAJIB self-contained: fungsi bantu didefinisi ulang di
//     dalam handler. Duplikasi blok bantu antar handler create/update/delete
//     DISENGAJA — jangan direfactor memakai closure/pabrik handler/tostring.
//   - state lintas-request (hitungan login) disimpan di DB (app_settings),
//     bukan memori VM — memori akan terpecah antar executor dan hilang.

routerAdd("GET", "/api/ekoteologi/ping", (e) => {
  return e.json(200, {
    name: $os.getenv("EKO_APP_NAME") || "ekoteologi-backend",
    version: $os.getenv("EKO_APP_VERSION") || "0.1.0-sprint13",
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

// ─────────────────────────  audit log (sprint 10)  ─────────────────────────
// Pengganti middleware audit FastAPI: create/update/delete koleksi bisnis +
// login sukses tercatat di `audit_logs` (tulis konteks sistem; baca admin).
//
// Temuan penting v0.40 (terverifikasi empiris saat membangun sprint 10):
//   - `onRecordAfter*Success` (RecordEvent) TIDAK membawa konteks request
//     (`e.auth` selalu undefined), dan hook request yang keluar TANPA
//     `e.next()` MENGABORSI rantai respons (klien terima 200 dgn body kosong).
//     Maka audit memakai hook request `onRecord{Create,Update,Delete}Request`:
//     jalankan `e.next()` lebih dulu — bila tulisan gagal, error melempar dan
//     tidak ada baris audit palsu — lalu tulis audit dgn aktor dari `e.auth`.
//   - Daftar koleksi terdaftar langsung sbg tag hook (varargs). Di luar
//     daftar: audit_logs (rekursi), llm_cache/app_settings (internal),
//     fcm_tokens/user_module_progress/user_quiz_attempts (sering berubah &
//     milik pemilik), point_transactions & user_badges (append-only via hook
//     ledger sprint 11–12), analytics_events, post_likes/post_comments
//     (fase 2).
//
// PENTING — batasan JSVM (lihat catatan di atas): tiap handler self-contained;
// duplikasi blok bantu antar handler create/update/delete DISENGAJA.

onRecordCreateRequest((e) => {
  e.next()

  let actorId = ""
  let actorLabel = "anonim"
  if (e.auth) {
    if (e.auth.collection().name === "users") {
      actorId = e.auth.id
      actorLabel = "user"
    } else {
      actorLabel = "superuser"
    }
  } else if (e.record.collection().name === "users") {
    // registrasi mandiri — aktor adalah akun yang baru dibuat
    actorId = e.record.id
    actorLabel = "user"
  }
  const diff = {}
  let props = {}
  try {
    props = e.record.publicExport() || {}
  } catch (err) {
    props = {}
  }
  const keys = Object.keys(props).slice(0, 40)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k === "password" || k === "tokenKey" || k === "emailVisibility") continue
    let val
    try {
      val = e.record.get(k)
    } catch (err) {
      continue
    }
    diff[k] = { old: null, new: val === undefined ? null : val }
  }
  diff._actor = actorLabel
  try {
    const col = e.app.findCollectionByNameOrId("audit_logs")
    const rec = new Record(col)
    rec.set("actor", actorId)
    rec.set("action", "create")
    rec.set("entity", e.record.collection().name)
    rec.set("entity_id", e.record.id)
    rec.set("diff", diff)
    e.app.save(rec)
  } catch (err) {
    console.log("audit create: gagal menulis: " + err)
  }
}, "users", "waste_categories", "levels", "badges", "rewards", "missions", "user_missions", "scans", "modules", "lessons", "quizzes", "quiz_questions", "daily_contents", "notifications", "posts", "reports", "map_locations", "redemptions")

onRecordUpdateRequest((e) => {
  e.next()

  let actorId = ""
  let actorLabel = "anonim"
  if (e.auth) {
    if (e.auth.collection().name === "users") {
      actorId = e.auth.id
      actorLabel = "user"
    } else {
      actorLabel = "superuser"
    }
  }
  // Diff lama→baru dari pasangan original() vs record hasil form.Load.
  let oldProps = {}
  let newProps = {}
  try {
    oldProps = e.record.original().publicExport() || {}
  } catch (err) {
    oldProps = {}
  }
  try {
    newProps = e.record.publicExport() || {}
  } catch (err) {
    newProps = {}
  }
  const diff = {}
  const keys = Object.keys(newProps).slice(0, 40)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k === "password" || k === "tokenKey" || k === "emailVisibility") continue
    const oldVal = oldProps[k] === undefined ? null : oldProps[k]
    const newVal = newProps[k] === undefined ? null : newProps[k]
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[k] = { old: oldVal, new: newVal }
    }
  }
  diff._actor = actorLabel
  try {
    const col = e.app.findCollectionByNameOrId("audit_logs")
    const rec = new Record(col)
    rec.set("actor", actorId)
    rec.set("action", "update")
    rec.set("entity", e.record.collection().name)
    rec.set("entity_id", e.record.id)
    rec.set("diff", diff)
    e.app.save(rec)
  } catch (err) {
    console.log("audit update: gagal menulis: " + err)
  }
}, "users", "waste_categories", "levels", "badges", "rewards", "missions", "user_missions", "scans", "modules", "lessons", "quizzes", "quiz_questions", "daily_contents", "notifications", "posts", "reports", "map_locations", "redemptions")

onRecordDeleteRequest((e) => {
  e.next()

  let actorId = ""
  let actorLabel = "anonim"
  if (e.auth) {
    if (e.auth.collection().name === "users") {
      actorId = e.auth.id
      actorLabel = "user"
    } else {
      actorLabel = "superuser"
    }
  }
  const diff = {}
  let props = {}
  try {
    props = e.record.publicExport() || {}
  } catch (err) {
    props = {}
  }
  const keys = Object.keys(props).slice(0, 40)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k === "password" || k === "tokenKey" || k === "emailVisibility") continue
    let val
    try {
      val = e.record.get(k)
    } catch (err) {
      continue
    }
    diff[k] = { old: val === undefined ? null : val, new: null }
  }
  diff._actor = actorLabel
  try {
    const col = e.app.findCollectionByNameOrId("audit_logs")
    const rec = new Record(col)
    rec.set("actor", actorId)
    rec.set("action", "delete")
    rec.set("entity", e.record.collection().name)
    rec.set("entity_id", e.record.id)
    rec.set("diff", diff)
    e.app.save(rec)
  } catch (err) {
    console.log("audit delete: gagal menulis: " + err)
  }
}, "users", "waste_categories", "levels", "badges", "rewards", "missions", "user_missions", "scans", "modules", "lessons", "quizzes", "quiz_questions", "daily_contents", "notifications", "posts", "reports", "map_locations", "redemptions")

// Login sukses (password/OAuth2) — audit + reset hitungan percobaan masuk.
// Catatan v0.40: event ini TIDAK punya `e.auth` — pakai `e.record`; dan hook
// yang keluar tanpa `e.next()` mengaborsi respons → SELALU return e.next().
// auth-refresh juga memicu hook ini — bukan login, jangan diaudit/direset.
onRecordAuthRequest((e) => {
  let path = ""
  try {
    path = e.request.url.path || ""
  } catch (err) {}
  if (path.indexOf("auth-refresh") !== -1 || !e.record) {
    return e.next()
  }

  let actorId = ""
  let actorLabel = "anonim"
  if (e.record.collection().name === "users") {
    actorId = e.record.id
    actorLabel = "user"
  }
  try {
    const col = e.app.findCollectionByNameOrId("audit_logs")
    const rec = new Record(col)
    rec.set("actor", actorId)
    rec.set("action", "login")
    rec.set("entity", "users")
    rec.set("entity_id", e.record.id)
    rec.set("diff", { via: e.authMethod || "auth", _actor: actorLabel })
    e.app.save(rec)
  } catch (err) {
    console.log("audit login: gagal menulis: " + err)
  }

  // Sukses login menghapus hitungan percobaan (paritas kebijakan lama).
  const identity = (e.record.get("email") || "").toString().toLowerCase()
  if (identity) {
    try {
      const guard = e.app.findFirstRecordByFilter("app_settings", "key = {:key}", { key: "login_guard:" + identity })
      e.app.delete(guard)
    } catch (err) {
      /* belum ada hitungan — tidak apa-apa */
    }
  }
  return e.next()
}, "users")

// ───────────────  guard percobaan masuk per-identitas (sprint 10)  ───────────────
// Rate limit settings (migrasi settings bootstrap) bekerja per-IP; guard ini
// meniru kebijakan lama "5 gagal / 15 menit per email" dgn 10 PERCOBAAN /
// 15 menit / email — rate limiter PB tidak bisa memfilter "hanya gagal" dan
// tidak per-identitas. Hitungan disimpan app_settings (key `login_guard:{email}`)
// — DB, bukan memori VM, agar deterministik lintas executor pool & tahan restart.
onRecordAuthWithPasswordRequest((e) => {
  const LOGIN_MAX = 10
  const WINDOW_MS = 15 * 60 * 1000

  const identity = (e.identity || "").toString()
  if (!identity) {
    return e.next()
  }

  const guardKey = "login_guard:" + identity.toLowerCase()
  const now = Date.now()
  let entry = { start: now, count: 0 }
  let rec = null
  try {
    rec = e.app.findFirstRecordByFilter("app_settings", "key = {:key}", { key: guardKey })
    let val = rec.get("value")
    // Nuansa JSVM v0.40: get() pada field json mengembalikan ARRAY BITA JSON
    // (mis. [123,34,...]) — bukan objek/string. Normalisasi defensif ke objek
    // agar hitungan tidak selalu reset ke 1 tiap percobaan.
    if (val && val.length !== undefined && typeof val !== "string" && typeof val.count === "undefined") {
      try {
        val = JSON.parse(String.fromCharCode.apply(null, val))
      } catch (parseErr) {
        val = {}
      }
    } else if (typeof val === "string") {
      try {
        val = JSON.parse(val)
      } catch (parseErr) {
        val = {}
      }
    }
    if (!val || typeof val !== "object") val = {}
    if (val && val.start && now - val.start < WINDOW_MS && val.count) {
      entry = { start: val.start, count: val.count }
    }
  } catch (err) {
    /* belum ada — mulai hitungan baru */
  }
  entry.count += 1
  try {
    if (!rec) {
      const col = e.app.findCollectionByNameOrId("app_settings")
      rec = new Record(col)
      rec.set("key", guardKey)
    }
    rec.set("value", entry)
    e.app.save(rec)
  } catch (err) {
    console.log("login guard: gagal simpan hitungan: " + err)
  }

  if (entry.count > LOGIN_MAX) {
    const minutes = Math.max(1, Math.ceil((entry.start + WINDOW_MS - now) / 60000))
    // Percobaan yang diblokir tercatat di audit (paritas `reason: rate_limited`).
    try {
      const col = e.app.findCollectionByNameOrId("audit_logs")
      const recAudit = new Record(col)
      recAudit.set("actor", "")
      recAudit.set("action", "login_failed")
      recAudit.set("entity", "users")
      recAudit.set("entity_id", identity.toLowerCase())
      recAudit.set("diff", { reason: "rate_limited", attempts: entry.count, _actor: "sistem" })
      e.app.save(recAudit)
    } catch (err) {
      console.log("login guard: gagal menulis audit: " + err)
    }
    throw new ApiError(429, "Terlalu banyak percobaan masuk. Coba lagi dalam " + minutes + " menit.")
  }
  return e.next()
}, "users")
