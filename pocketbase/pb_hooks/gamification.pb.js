/// <reference path="../pb_data/types.d.ts" />
// Ekoteologi AR — Sprint 12: Misi, Verifikasi & Gamifikasi (pb_hooks/gamification.pb.js).
//
// Isi file ini:
//   1. POST /api/ekoteologi/missions/{id}/claim — klaim misi photo (bukti +
//      consent) & manual (auto-approve + poin); auto_scan ditolak (progres
//      dari scan). Periode & anti dobel dihitung server (paritas
//      POST /v1/missions/{id}/claim FastAPI).
//   2. GET /api/ekoteologi/badges — lazy badge sync + daftar lencana+earned
//      (paritas GET /v1/badges FastAPI).
//   3. GET /api/ekoteologi/streak — status streak efektif + kalender 7 hari
//      dari ledger (paritas GET /v1/streak FastAPI).
//   4. Cron reminder streak (`cronAdd`, env STREAK_REMINDER_CRON) + route
//      trigger manual POST /api/ekoteologi/cron/streak-reminder (admin) —
//      menulis notifikasi in-app; pengiriman push FCM menyusul Sprint 13.
//   5. Engine review klaim — hook REQUEST guard (staff saja, keputusan
//      diserverkan) + hook MODEL user_missions: submitted→approved → ledger +
//      notifikasi + event + streak + badge (satu transaksi dgn save klaim);
//      submitted→rejected → notifikasi (catatan wajib di guard request).
//   6. Hook MODEL scans create — streak harian (reset lazy + bonus kelipatan
//      env-driven), progres misi auto_scan (scan_category_id/required_count),
//      dan badge engine on-event.
//   7. Guard DELETE missions — ditolak bila sudah ada klaim (jaga riwayat).
//
// Konfigurasi env (lihat .env.example): MISSION_IMAGE_MAX_MB (default 5),
// STREAK_BONUS_POINTS (default 20), STREAK_BONUS_EVERY_DAYS (default 6, 0 =
// bonus mati), STREAK_REMINDER (default aktif), STREAK_REMINDER_CRON
// (default "0 8 * * *").
//
// PENTING — batasan JSVM v0.40 (temuan sprint 9–11, terverifikasi):
//   - handler hook dikirim ke Go sbg SUMBER fungsi (stringify) lalu
//     dikompilasi ulang di executor VM pool → closure atas helper top-level
//     TIDAK terbawa. Setiap handler/hook WAJIB self-contained; duplikasi blok
//     bantu antar handler DISENGAJA (jangan direfactor ke closure/pabrik).
//   - `get()` pada field json mengembalikan array bita JSON → normalisasi
//     jsonValue().
//   - get() field date bisa Date/string/time.Time → dayOf()/momentOf().

// ═══════════════ 1. POST /api/ekoteologi/missions/{id}/claim ═══════════════

routerAdd("POST", "/api/ekoteologi/missions/{id}/claim", (e) => {
  // ── blok bantu (self-contained — lihat catatan JSVM) ──
  function envInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n < 0 ? fallback : n
  }
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }
  function pbDate(d) {
    return isoDay(d) + " 00:00:00.000Z"
  }
  function nowIso() {
    return new Date().toISOString()
  }
  function dayOf(v) {
    // Tanggal LOKAL dari timestamp sistem (created — UTC) atau Date.
    if (!v) return ""
    if (v instanceof Date) return isoDay(v)
    const d = new Date(String(v).replace(" ", "T"))
    return isNaN(d.getTime()) ? String(v).slice(0, 10) : isoDay(d)
  }
  function dayOfStored(v) {
    // Tanggal dari field date yang KITA tulis sbg tanggal-lokal@UTC-tengah
    // malam (last_active_date) — ambil bagian tanggalnya saja (jangan
    // dikonversi ulang lewat zona waktu).
    if (!v) return ""
    return String(v instanceof Date ? v.toISOString() : v).slice(0, 10)
  }
  function momentOf(v) {
    if (!v) return 0
    if (v instanceof Date) return v.getTime()
    const s = String(v).replace(" ", "T")
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z")
    return isNaN(t) ? 0 : t
  }
  function withinWindow(mission, nowMs) {
    const start = momentOf(mission.get("start_at"))
    const end = momentOf(mission.get("end_at"))
    if (start && nowMs < start) return false
    if (end && nowMs > end) return false
    return true
  }
  // Tanggal periode klaim — kunci anti dobel (paritas period_date_for):
  // weekly → Senin minggu berjalan; daily/special → hari ini (server).
  function periodFor(mission) {
    const d = new Date()
    if ((mission.get("type") || "") === "weekly") {
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    }
    return pbDate(d)
  }
  function findClaim(app, uid, missionId, period) {
    try {
      return app.findFirstRecordByFilter(
        "user_missions",
        "user = {:u} && mission = {:m} && period_date = {:p}",
        { u: uid, m: missionId, p: period }
      )
    } catch (err) {
      return null
    }
  }
  function notifyUser(app, uid, title, body, type, payload) {
    try {
      const rec = new Record(app.findCollectionByNameOrId("notifications"))
      rec.set("user", uid)
      rec.set("title", title)
      rec.set("body", body)
      rec.set("type", type)
      rec.set("payload", payload)
      app.save(rec)
    } catch (err) {
      console.log("CLAIM: notifikasi gagal ditulis: " + err)
    }
  }
  function addEvent(app, uid, name, payload) {
    try {
      const rec = new Record(app.findCollectionByNameOrId("analytics_events"))
      rec.set("user", uid)
      rec.set("name", name)
      rec.set("payload", payload)
      app.save(rec)
    } catch (err) {
      console.log("CLAIM: event gagal ditulis: " + err)
    }
  }
  // Ledger append-only — hook MODEL point_transactions (scan.pb.js) yang
  // menyinkronkan users.points + level dalam transaksi yang sama.
  function addLedger(app, uid, amount, source, refId, note) {
    const rec = new Record(app.findCollectionByNameOrId("point_transactions"))
    rec.set("user", uid)
    rec.set("amount", amount)
    rec.set("source", source)
    rec.set("ref_id", refId || "")
    rec.set("note", note || "")
    app.save(rec)
  }
  function touchStreak(app, uid) {
    const today = isoDay(new Date())
    let user = null
    try {
      user = app.findRecordById("users", uid)
    } catch (err) {
      return { streak: 0, bonus: 0, incremented: false }
    }
    const last = dayOfStored(user.get("last_active_date"))
    if (last === today) {
      return { streak: user.get("current_streak") || 0, bonus: 0, incremented: false }
    }
    let streak = 1
    const y = new Date()
    y.setDate(y.getDate() - 1)
    if (last === isoDay(y)) {
      streak = Math.max(1, (user.get("current_streak") || 0) + 1)
    }
    user.set("current_streak", streak)
    user.set("longest_streak", Math.max(user.get("longest_streak") || 0, streak))
    user.set("last_active_date", pbDate(new Date()))
    app.save(user)

    let bonus = 0
    const every = envInt("STREAK_BONUS_EVERY_DAYS", 6)
    const bonusPts = envInt("STREAK_BONUS_POINTS", 20)
    if (every > 0 && bonusPts > 0 && streak % every === 0) {
      bonus = bonusPts
      addLedger(app, uid, bonus, "streak", "", "Bonus streak " + streak + " hari berturut-turut")
      notifyUser(
        app,
        uid,
        "Bonus streak " + streak + " hari!",
        "Konsistensimu terjaga " + streak + " hari — bonus +" + bonus + " poin masuk ke akunmu.",
        "streak",
        { streak: streak, points: bonus }
      )
    }
    addEvent(app, uid, "streak_hari", { streak: streak, bonus: bonus })
    return { streak: streak, bonus: bonus, incremented: true }
  }
  function syncBadges(app, uid, delta) {
    function jsonValue(raw) {
      if (raw === undefined || raw === null) return null
      if (typeof raw === "string") {
        try {
          return JSON.parse(raw)
        } catch (err) {
          return null
        }
      }
      if (typeof raw === "object" && raw.length !== undefined && typeof raw.count === "undefined") {
        try {
          return JSON.parse(String.fromCharCode.apply(null, raw))
        } catch (err) {
          return null
        }
      }
      return raw
    }
    // Temuan v0.40: $dbx.exp TIDAK mengikat named params dan .all()/.one()
    // dbx gagal ("must be a pointer") di JSVM — statistik memakai
    // findRecordsByFilter (binding params teruji) + agregasi di JS; volume
    // baris per-user kecil utk skala MVP. Baris yang baru ditulis dalam tx
    // berjalan tidak terlihat oleh query ini — dikompensasi lewat delta.
    const scanRows =
      app.findRecordsByFilter("scans", "user = {:u} && points > 0", "", 0, 0, { u: uid }) || []
    const missionRows =
      app.findRecordsByFilter("user_missions", "user = {:u} && status = {:s}", "", 0, 0, {
        u: uid,
        s: "approved",
      }) || []
    const quizRows =
      app.findRecordsByFilter("user_quiz_attempts", "user = {:u} && passed = true", "", 0, 0, {
        u: uid,
      }) || []
    const scanCount = scanRows.length + ((delta && delta.scan) || 0)
    const missionDone = missionRows.length + ((delta && delta.mission) || 0)
    const quizPassed = quizRows.length + ((delta && delta.quiz) || 0)
    const user = app.findRecordById("users", uid)
    const streak = Math.max(user.get("longest_streak") || 0, user.get("current_streak") || 0)
    let pointsEarned = (delta && delta.points) || 0
    const ledgerRows =
      app.findRecordsByFilter("point_transactions", "user = {:u}", "", 0, 0, { u: uid }) || []
    for (let li = 0; li < ledgerRows.length; li++) {
      pointsEarned += ledgerRows[li].get("amount") || 0
    }
    function statOf(t) {
      if (t === "scan_count") return scanCount
      if (t === "mission_done") return missionDone
      if (t === "streak") return streak
      if (t === "points_earned") return pointsEarned
      if (t === "quiz_passed") return quizPassed
      return 0
    }
    const owned = {}
    const ownedRows = app.findRecordsByFilter("user_badges", "user = {:u}", "", 0, 0, { u: uid }) || []
    for (let i = 0; i < ownedRows.length; i++) {
      owned[String(ownedRows[i].get("badge"))] = true
    }
    const badges = app.findRecordsByFilter("badges", "id != ''", "code", 0, 0) || []
    const earned = []
    for (let i = 0; i < badges.length; i++) {
      const b = badges[i]
      if (owned[String(b.id)]) continue
      const criteria = jsonValue(b.get("criteria"))
      // fail-closed: kriteria korup/tidak dikenal TIDAK otomatis diraih.
      if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) continue
      const t = String(criteria.type || "")
      const target = criteria.value
      if (!t || typeof target !== "number" || !isFinite(target) || target <= 0) continue
      if (statOf(t) < target) continue
      const rec = new Record(app.findCollectionByNameOrId("user_badges"))
      rec.set("user", uid)
      rec.set("badge", b.id)
      try {
        app.save(rec)
      } catch (err) {
        continue // balapan unik — lencana sudah diraih jalur lain (idempoten)
      }
      earned.push({ code: b.get("code") || "", name: b.get("name") || "" })
      notifyUser(
        app,
        uid,
        "Lencana baru: " + (b.get("name") || b.get("code") || "lencana"),
        b.get("description") || "Kamu baru saja meraih lencana. Pertahankan!",
        "info",
        { badge_id: b.id, badge_code: b.get("code") || "" }
      )
    }
    return earned
  }

  // ── auth + misi ──
  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }
  const uid = auth.id
  const missionId = e.request.pathValue("id")
  let mission = null
  try {
    mission = e.app.findRecordById("missions", missionId)
  } catch (err) {
    throw new ApiError(404, "Misi tidak ditemukan.")
  }
  if (!mission.get("is_active")) {
    throw new ApiError(409, "Misi ini sudah tidak aktif.")
  }
  const nowMs = Date.now()
  if (!withinWindow(mission, nowMs)) {
    throw new ApiError(409, "Misi ini belum dibuka atau sudah melewati periodenya.")
  }
  const mode = mission.get("verification") || "photo"
  if (mode === "auto_scan") {
    throw new ApiError(
      400,
      "Progres misi ini dihitung otomatis dari scan — buka layar Scan untuk mengerjakannya."
    )
  }

  const period = periodFor(mission)
  const existing = findClaim(e.app, uid, mission.id, period)
  if (existing) {
    const st = existing.get("status") || ""
    if (st === "approved") throw new ApiError(409, "Misi ini sudah selesai untuk periode ini.")
    if (st !== "rejected") {
      throw new ApiError(409, "Kamu sudah mengklaim misi ini — menunggu verifikasi admin.")
    }
    // rejected → baris sama dipakai ulang (bukti boleh diganti — paritas FastAPI)
  }

  const body = e.requestInfo().body || {}
  const now = nowIso()
  const title = mission.get("title") || "Misi"
  const points = mission.get("points") || 0
  let claim = existing
  let message = ""

  // ── validasi klaim photo SEBELUM record dibuat (gagal validasi ≠ klaim) ──
  let fileObj = null
  let note = ""
  if (mode === "photo") {
    const consentRaw = body.consent
    const consent =
      consentRaw === true || consentRaw === 1 || consentRaw === "1" ||
      consentRaw === "true" || consentRaw === "on"
    if (!consent) {
      throw new ApiError(
        400,
        "Persetujuan penggunaan foto wajib diberikan sebelum mengunggah bukti."
      )
    }
    try {
      const files = e.findUploadedFiles("proof")
      if (files && files.length > 0) fileObj = files[0]
    } catch (err) {
      fileObj = null
    }
    if (!fileObj || !fileObj.size) {
      throw new ApiError(400, "Foto bukti wajib diunggah.")
    }
    const MAX_MB = envInt("MISSION_IMAGE_MAX_MB", 5)
    const MAX_BYTES = MAX_MB * 1024 * 1024
    if (fileObj.size > MAX_BYTES) {
      throw new ApiError(413, "Ukuran foto maksimal " + MAX_MB + " MB.")
    }
    const bytes = toBytes(fileObj.reader.open(), MAX_BYTES + 1)
    let isImg = false
    if (bytes && bytes.length > 3) {
      if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) isImg = true
      else if (
        bytes.length > 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      ) isImg = true
      else if (
        bytes.length > 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
      ) isImg = true
    }
    if (!isImg) {
      throw new ApiError(400, "Format foto harus JPG, PNG, atau WebP.")
    }
    note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : ""
  }

  try {
    e.app.runInTransaction(function (txApp) {
      if (!claim) {
        claim = new Record(txApp.findCollectionByNameOrId("user_missions"))
        claim.set("user", uid)
        claim.set("mission", mission.id)
        claim.set("period_date", period)
      }
      if (mode === "photo") {
        claim.set("status", "submitted")
        claim.set("points_awarded", 0)
        claim.set("proof", fileObj) // replace otomatis bukti lama (resubmission)
        claim.set("note", note)
        claim.set("consent_at", now)
        claim.set("submitted_at", now)
        claim.set("reviewed_by", "")
        claim.set("reviewed_at", "")
        claim.set("review_note", "")
        txApp.save(claim)
      } else {
        // manual: auto-approve saat klaim (reviewed_by kosong = sistem)
        claim.set("status", "approved")
        claim.set("points_awarded", points)
        claim.set("reviewed_at", now)
        claim.set("review_note", "")
        txApp.save(claim)
        addLedger(txApp, uid, points, "mission", claim.id, "Misi manual: " + title)
        notifyUser(
          txApp,
          uid,
          "Poin misi masuk",
          '"' + title + '" diklaim — +' + points + " poin masuk ke akunmu.",
          "mission",
          { claim_id: claim.id, mission_id: mission.id, status: "approved", points: points }
        )
        addEvent(txApp, uid, "misi_selesai", {
          mission_id: mission.id,
          points: points,
          claim_id: claim.id,
        })
        const stClaim = touchStreak(txApp, uid)
        syncBadges(txApp, uid, {
          mission: 1,
          points: points + ((stClaim && stClaim.bonus) || 0),
        })
      }
    })
  } catch (err) {
    const msg = String(err || "")
    if (msg.indexOf("UNIQUE") !== -1 || msg.indexOf("unique") !== -1) {
      // balapan dua klaim serentak — index UNIQUE mencegah dobel (PRD §5.10 #3)
      throw new ApiError(409, "Kamu sudah mengklaim misi ini untuk periode ini.")
    }
    console.log("CLAIM gagal: " + msg)
    throw new ApiError(500, "Klaim tidak dapat disimpan. Silakan coba lagi.")
  }

  message =
    mode === "photo"
      ? "Bukti terkirim — menunggu verifikasi admin (maks. 1×24 jam)."
      : "Misi diklaim! +" + points + " poin langsung masuk ke akunmu."

  // Audit manual (pembuatan record via konteks internal tidak memicu hook
  // request — pola yang sama dgn route scan sprint 11).
  try {
    const col = e.app.findCollectionByNameOrId("audit_logs")
    const recAudit = new Record(col)
    recAudit.set("actor", uid)
    recAudit.set("action", "mission_claim")
    recAudit.set("entity", "user_missions")
    recAudit.set("entity_id", claim.id)
    recAudit.set("diff", {
      mission_id: mission.id,
      mission: title,
      mode: mode,
      period_date: period,
      resubmit: !!existing,
      points: mode === "manual" ? points : 0,
      _actor: "user",
    })
    e.app.save(recAudit)
  } catch (err) {
    console.log("CLAIM: audit gagal menulis: " + err)
  }

  let pointsTotal = 0
  try {
    pointsTotal = e.app.findRecordById("users", uid).get("points") || 0
  } catch (err) {
    pointsTotal = 0
  }
  console.log(
    "MISSION CLAIM " + mode + " claim=" + claim.id + " user=" + uid + " mission=" + mission.id +
      " period=" + period.slice(0, 10) + " status=" + (claim.get("status") || "")
  )
  return e.json(200, {
    claim: {
      id: claim.id,
      status: claim.get("status") || "",
      progress_count: claim.get("progress_count") || 0,
      points_awarded: claim.get("points_awarded") || 0,
      review_note: claim.get("review_note") || null,
      submitted_at: claim.get("submitted_at") || null,
    },
    message: message,
    points_total: pointsTotal,
  })
}, $apis.requireAuth("users"))

// ═══════════════ 2. GET /api/ekoteologi/badges (lazy sync + daftar) ═══════════════

routerAdd("GET", "/api/ekoteologi/badges", (e) => {
  function jsonValue(raw) {
    if (raw === undefined || raw === null) return null
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw)
      } catch (err) {
        return null
      }
    }
    if (typeof raw === "object" && raw.length !== undefined && typeof raw.count === "undefined") {
      try {
        return JSON.parse(String.fromCharCode.apply(null, raw))
      } catch (err) {
        return null
      }
    }
    return raw
  }
  function notifyUser(app, uid, title, body, type, payload) {
    try {
      const rec = new Record(app.findCollectionByNameOrId("notifications"))
      rec.set("user", uid)
      rec.set("title", title)
      rec.set("body", body)
      rec.set("type", type)
      rec.set("payload", payload)
      app.save(rec)
    } catch (err) {
      console.log("BADGES: notifikasi gagal ditulis: " + err)
    }
  }
  function syncBadges(app, uid, delta) {
    // Temuan v0.40: $dbx.exp TIDAK mengikat named params dan .all()/.one()
    // dbx gagal ("must be a pointer") di JSVM — statistik memakai
    // findRecordsByFilter (binding params teruji) + agregasi di JS; volume
    // baris per-user kecil utk skala MVP. Baris yang baru ditulis dalam tx
    // berjalan tidak terlihat oleh query ini — dikompensasi lewat delta.
    const scanRows =
      app.findRecordsByFilter("scans", "user = {:u} && points > 0", "", 0, 0, { u: uid }) || []
    const missionRows =
      app.findRecordsByFilter("user_missions", "user = {:u} && status = {:s}", "", 0, 0, {
        u: uid,
        s: "approved",
      }) || []
    const quizRows =
      app.findRecordsByFilter("user_quiz_attempts", "user = {:u} && passed = true", "", 0, 0, {
        u: uid,
      }) || []
    const scanCount = scanRows.length + ((delta && delta.scan) || 0)
    const missionDone = missionRows.length + ((delta && delta.mission) || 0)
    const quizPassed = quizRows.length + ((delta && delta.quiz) || 0)
    const user = app.findRecordById("users", uid)
    const streak = Math.max(user.get("longest_streak") || 0, user.get("current_streak") || 0)
    let pointsEarned = (delta && delta.points) || 0
    const ledgerRows =
      app.findRecordsByFilter("point_transactions", "user = {:u}", "", 0, 0, { u: uid }) || []
    for (let li = 0; li < ledgerRows.length; li++) {
      pointsEarned += ledgerRows[li].get("amount") || 0
    }
    function statOf(t) {
      if (t === "scan_count") return scanCount
      if (t === "mission_done") return missionDone
      if (t === "streak") return streak
      if (t === "points_earned") return pointsEarned
      if (t === "quiz_passed") return quizPassed
      return 0
    }
    const owned = {}
    const ownedRows = app.findRecordsByFilter("user_badges", "user = {:u}", "", 0, 0, { u: uid }) || []
    for (let i = 0; i < ownedRows.length; i++) {
      owned[String(ownedRows[i].get("badge"))] = true
    }
    const badges = app.findRecordsByFilter("badges", "id != ''", "code", 0, 0) || []
    const earned = []
    for (let i = 0; i < badges.length; i++) {
      const b = badges[i]
      if (owned[String(b.id)]) continue
      const criteria = jsonValue(b.get("criteria"))
      if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) continue
      const t = String(criteria.type || "")
      const target = criteria.value
      if (!t || typeof target !== "number" || !isFinite(target) || target <= 0) continue
      if (statOf(t) < target) continue
      const rec = new Record(app.findCollectionByNameOrId("user_badges"))
      rec.set("user", uid)
      rec.set("badge", b.id)
      try {
        app.save(rec)
      } catch (err) {
        continue
      }
      earned.push({ code: b.get("code") || "", name: b.get("name") || "" })
      notifyUser(
        app,
        uid,
        "Lencana baru: " + (b.get("name") || b.get("code") || "lencana"),
        b.get("description") || "Kamu baru saja meraih lencana. Pertahankan!",
        "info",
        { badge_id: b.id, badge_code: b.get("code") || "" }
      )
    }
    return earned
  }
  function isoOf(v) {
    if (!v) return null
    if (v instanceof Date) return v.toISOString()
    const s = String(v)
    return s ? s.replace(" ", "T") : null
  }

  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }
  const uid = auth.id
  const earned = syncBadges(e.app, uid, 0)
  if (earned.length > 0) {
    console.log("BADGES earned (lazy) user=" + uid + " codes=" + earned.map((b) => b.code).join(","))
  }
  const badges = e.app.findRecordsByFilter("badges", "id != ''", "code", 0, 0) || []
  const ownedRows = e.app.findRecordsByFilter("user_badges", "user = {:u}", "", 0, 0, { u: uid }) || []
  const earnedAt = {}
  for (let i = 0; i < ownedRows.length; i++) {
    earnedAt[String(ownedRows[i].get("badge"))] = isoOf(ownedRows[i].get("created"))
  }
  const items = []
  for (let i = 0; i < badges.length; i++) {
    const b = badges[i]
    items.push({
      id: b.id,
      code: b.get("code") || "",
      name: b.get("name") || null,
      icon: b.get("icon") || null,
      description: b.get("description") || null,
      earned: !!earnedAt[b.id],
      earned_at: earnedAt[b.id] || null,
    })
  }
  return e.json(200, items)
}, $apis.requireAuth("users"))

// ═══════════════ 3. GET /api/ekoteologi/streak (status + kalender) ═══════════════

routerAdd("GET", "/api/ekoteologi/streak", (e) => {
  function envInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n < 0 ? fallback : n
  }
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }
  function pbDate(d) {
    return isoDay(d) + " 00:00:00.000Z"
  }
  function dayOf(v) {
    // Tanggal LOKAL dari timestamp sistem (created — UTC) atau Date.
    if (!v) return ""
    if (v instanceof Date) return isoDay(v)
    const d = new Date(String(v).replace(" ", "T"))
    return isNaN(d.getTime()) ? String(v).slice(0, 10) : isoDay(d)
  }
  function dayOfStored(v) {
    // Tanggal dari field date yang KITA tulis sbg tanggal-lokal@UTC-tengah
    // malam (last_active_date) — ambil bagian tanggalnya saja (jangan
    // dikonversi ulang lewat zona waktu).
    if (!v) return ""
    return String(v instanceof Date ? v.toISOString() : v).slice(0, 10)
  }

  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }
  const uid = auth.id
  const user = e.app.findRecordById("users", uid)
  const today = isoDay(new Date())
  const y = new Date()
  y.setDate(y.getDate() - 1)
  const yesterday = isoDay(y)
  const last = dayOfStored(user.get("last_active_date"))
  // Streak efektif (paritas effective_streak): masih dipajang bila terakhir
  // aktif kemarin; bolong ≥2 hari → 0 (reset lazy terjadi saat aktif lagi).
  let current = 0
  if (last === today || last === yesterday) {
    current = user.get("current_streak") || 0
  }

  // Kalender 7 hari dari ledger (semua aktivitas bernilai menulis ledger).
  // Batas bawah = tengah malam LOKAL 6 hari lalu (ISO eksak — created
  // tersimpan UTC; pbDate() tidak dipakai di sini agar tepat lintas zona).
  const weekStartIso = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    new Date().getDate() - 6
  ).toISOString()
  const rows =
    e.app.findRecordsByFilter(
      "point_transactions",
      "user = {:u} && created >= {:s}",
      "-created",
      0,
      0,
      { u: uid, s: weekStartIso }
    ) || []
  const active = {}
  for (let i = 0; i < rows.length; i++) {
    active[dayOf(rows[i].get("created"))] = true
  }
  const week = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const day = isoDay(d)
    week.push({ date: day, active: !!active[day] })
  }

  const every = envInt("STREAK_BONUS_EVERY_DAYS", 6)
  const bonusPoints = envInt("STREAK_BONUS_POINTS", 20)
  const remainder = every > 0 ? current % every : 0
  return e.json(200, {
    current_streak: current,
    longest_streak: Math.max(user.get("longest_streak") || 0, current),
    active_today: last === today,
    last_active_date: last || null,
    bonus_points: bonusPoints,
    bonus_every_days: every,
    days_to_bonus: every > 0 ? (remainder !== 0 ? every - remainder : every) : 0,
    week: week,
  })
}, $apis.requireAuth("users"))

// ═════════ 4. Cron reminder streak + trigger manual (admin) ═════════
// Notifikasi in-app utk user yang aktif KEMARIN tapi belum aktif hari ini
// (streak berisiko). Push FCM menyusul Sprint 13 — saat ini cukup record
// notifikasi (tipe "streak"). Idempoten per hari via guard app_settings.

cronAdd("ekoteologi_streak_reminder", $os.getenv("STREAK_REMINDER_CRON") || "0 8 * * *", () => {
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }
  function pbDate(d) {
    return isoDay(d) + " 00:00:00.000Z"
  }
  function runReminder(app) {
    if (($os.getenv("STREAK_REMINDER") || "1") === "0") return 0
    const now = new Date()
    const todayStart = pbDate(now)
    const y = new Date()
    y.setDate(y.getDate() - 1)
    const yesterdayStart = pbDate(y)
    let rows = []
    try {
      rows =
        app.findRecordsByFilter(
          "users",
          "is_active = {:a} && last_active_date >= {:y} && last_active_date < {:t}",
          "",
          0,
          0,
          { a: true, y: yesterdayStart, t: todayStart }
        ) || []
    } catch (err) {
      console.log("CRON streak reminder: query user gagal: " + err)
      return 0
    }
    let sent = 0
    for (let i = 0; i < rows.length; i++) {
      const u = rows[i]
      const guardKey = "sr:" + u.id + ":" + isoDay(now)
      try {
        app.findFirstRecordByFilter("app_settings", "key = {:k}", { k: guardKey })
        continue // sudah dikirim hari ini
      } catch (err) {
        /* belum — kirim */
      }
      try {
        const rec = new Record(app.findCollectionByNameOrId("notifications"))
        rec.set("user", u.id)
        rec.set("title", "Streak " + (u.get("current_streak") || 0) + " hari berisiko!")
        rec.set(
          "body",
          "Jangan sampai putus — lakukan satu scan atau klaim satu misi hari ini untuk menjaga streakmu."
        )
        rec.set("type", "streak")
        rec.set("payload", { streak: u.get("current_streak") || 0, kind: "reminder" })
        app.save(rec)
        const guard = new Record(app.findCollectionByNameOrId("app_settings"))
        guard.set("key", guardKey)
        guard.set("value", { sent_at: now.toISOString() })
        app.save(guard)
        sent++
      } catch (err) {
        console.log("CRON streak reminder: notif gagal utk " + u.id + ": " + err)
      }
    }
    return sent
  }
  const sent = runReminder($app)
  console.log("CRON ekoteologi_streak_reminder: " + sent + " notifikasi dikirim")
})

routerAdd("POST", "/api/ekoteologi/cron/streak-reminder", (e) => {
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }
  function pbDate(d) {
    return isoDay(d) + " 00:00:00.000Z"
  }
  const auth = e.auth
  if (!auth || auth.collection().name !== "users" || auth.get("role") !== "admin") {
    throw new UnauthorizedError("Hanya admin yang dapat memicu reminder.")
  }
  function runReminder(app) {
    if (($os.getenv("STREAK_REMINDER") || "1") === "0") return 0
    const now = new Date()
    const todayStart = pbDate(now)
    const y = new Date()
    y.setDate(y.getDate() - 1)
    const yesterdayStart = pbDate(y)
    let rows = []
    try {
      rows =
        app.findRecordsByFilter(
          "users",
          "is_active = {:a} && last_active_date >= {:y} && last_active_date < {:t}",
          "",
          0,
          0,
          { a: true, y: yesterdayStart, t: todayStart }
        ) || []
    } catch (err) {
      return 0
    }
    let sent = 0
    for (let i = 0; i < rows.length; i++) {
      const u = rows[i]
      const guardKey = "sr:" + u.id + ":" + isoDay(now)
      try {
        app.findFirstRecordByFilter("app_settings", "key = {:k}", { k: guardKey })
        continue
      } catch (err) {
        /* belum — kirim */
      }
      try {
        const rec = new Record(app.findCollectionByNameOrId("notifications"))
        rec.set("user", u.id)
        rec.set("title", "Streak " + (u.get("current_streak") || 0) + " hari berisiko!")
        rec.set(
          "body",
          "Jangan sampai putus — lakukan satu scan atau klaim satu misi hari ini untuk menjaga streakmu."
        )
        rec.set("type", "streak")
        rec.set("payload", { streak: u.get("current_streak") || 0, kind: "reminder" })
        app.save(rec)
        const guard = new Record(app.findCollectionByNameOrId("app_settings"))
        guard.set("key", guardKey)
        guard.set("value", { sent_at: now.toISOString() })
        app.save(guard)
        sent++
      } catch (err) {
        console.log("REMINDER: notif gagal utk " + u.id + ": " + err)
      }
    }
    return sent
  }
  const sent = runReminder(e.app)
  return e.json(200, { sent: sent })
}, $apis.requireAuth("users"))

// ═════ 5. Engine review klaim — guard request (staff) + efek transaksional ═════
// PATCH user_missions kini hanya utk keputusan verifier/admin (updateRule staff
// + guard ini): status/points_awarded/reviewed_* DISERVERKAN — klien tidak
// bisa menetapkan poin sendiri. Efek poin/notif/streak/badge hidup di hook
// MODEL di bawah (satu transaksi dgn save klaim).

onRecordUpdateRequest((e) => {
  const auth = e.auth
  if (!auth) {
    throw new ApiError(403, "Butuh autentikasi.")
  }
  const isSuperuser = auth.collection().name === "_superusers"
  const role = isSuperuser ? "admin" : auth.get("role") || ""
  if (role !== "admin" && role !== "verifier") {
    throw new ApiError(403, "Hanya verifier dan admin yang dapat meninjau klaim.")
  }
  const oldStatus = String(e.record.original().get("status") || "")
  if (oldStatus !== "submitted") {
    throw new ApiError(409, "Klaim ini sudah direview sebelumnya — muat ulang antrian.")
  }
  const body = e.requestInfo().body || {}
  const decision = body.status
  if (decision !== "approved" && decision !== "rejected") {
    throw new ApiError(400, "Keputusan harus 'approved' atau 'rejected'.")
  }
  const note = typeof body.review_note === "string" ? body.review_note.trim() : ""
  if (decision === "rejected" && !note) {
    throw new ApiError(
      400,
      "Catatan wajib diisi saat menolak — agar user tahu apa yang perlu diperbaiki."
    )
  }
  let mission = null
  try {
    mission = e.app.findRecordById("missions", e.record.get("mission"))
  } catch (err) {
    throw new ApiError(409, "Misi klaim ini sudah tidak ada.")
  }
  const now = new Date().toISOString()
  e.record.set("reviewed_at", now)
  if (!isSuperuser) {
    e.record.set("reviewed_by", auth.id) // relasi users — id superuser tak valid
  }
  if (decision === "rejected") {
    e.record.set("status", "rejected")
    e.record.set("points_awarded", 0)
    e.record.set("review_note", note)
  } else {
    e.record.set("status", "approved")
    e.record.set("points_awarded", mission.get("points") || 0)
    if (note) e.record.set("review_note", note)
  }
  return e.next()
}, "user_missions")

// Hook MODEL: transisi status dijaga + efek keputusan review (satu transaksi
// dgn save — ledger/notif/event/streak/badge atomik dgn perubahan klaim).
// Transisi internal yang diizinkan: rejected→submitted (klaim ulang via
// route), in_progress→in_progress/approved (progres auto_scan via hook scan).
onRecordUpdate((e) => {
  const oldStatus = String(e.record.original().get("status") || "")
  const newStatus = String(e.record.get("status") || "")
  const allowed =
    oldStatus === "" || // temuan v0.40: save lanjutan record baru di dalam tx yang sama memicu hook update dgn original() kosong
    oldStatus === newStatus ||
    (oldStatus === "submitted" && (newStatus === "approved" || newStatus === "rejected")) ||
    (oldStatus === "rejected" && newStatus === "submitted") ||
    (oldStatus === "in_progress" && (newStatus === "in_progress" || newStatus === "approved"))
  if (!allowed) {
    throw new BadRequestError(
      "Transisi status klaim tidak diizinkan (" + oldStatus + " → " + newStatus + ")."
    )
  }
  e.next()

  if (oldStatus !== "submitted") return // hanya keputusan review yang berefek
  const uid = e.record.get("user")
  const missionId = e.record.get("mission")
  let mission = null
  try {
    mission = e.app.findRecordById("missions", missionId)
  } catch (err) {
    throw new BadRequestError("Misi klaim ini sudah tidak ada.")
  }
  const title = mission.get("title") || "Misi"

  // ── blok bantu (self-contained — duplikasi antar hook DISENGAJA) ──
  function envInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n < 0 ? fallback : n
  }
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }
  function pbDate(d) {
    return isoDay(d) + " 00:00:00.000Z"
  }
  function dayOf(v) {
    // Tanggal LOKAL dari timestamp sistem (created — UTC) atau Date.
    if (!v) return ""
    if (v instanceof Date) return isoDay(v)
    const d = new Date(String(v).replace(" ", "T"))
    return isNaN(d.getTime()) ? String(v).slice(0, 10) : isoDay(d)
  }
  function dayOfStored(v) {
    // Tanggal dari field date yang KITA tulis sbg tanggal-lokal@UTC-tengah
    // malam (last_active_date) — ambil bagian tanggalnya saja (jangan
    // dikonversi ulang lewat zona waktu).
    if (!v) return ""
    return String(v instanceof Date ? v.toISOString() : v).slice(0, 10)
  }
  function jsonValue(raw) {
    if (raw === undefined || raw === null) return null
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw)
      } catch (err) {
        return null
      }
    }
    if (typeof raw === "object" && raw.length !== undefined && typeof raw.count === "undefined") {
      try {
        return JSON.parse(String.fromCharCode.apply(null, raw))
      } catch (err) {
        return null
      }
    }
    return raw
  }
  function notifyUser(app, uid2, ntitle, nbody, ntype, payload) {
    try {
      const rec = new Record(app.findCollectionByNameOrId("notifications"))
      rec.set("user", uid2)
      rec.set("title", ntitle)
      rec.set("body", nbody)
      rec.set("type", ntype)
      rec.set("payload", payload)
      app.save(rec)
    } catch (err) {
      console.log("REVIEW: notifikasi gagal ditulis: " + err)
    }
  }
  function addEvent(app, uid2, name, payload) {
    try {
      const rec = new Record(app.findCollectionByNameOrId("analytics_events"))
      rec.set("user", uid2)
      rec.set("name", name)
      rec.set("payload", payload)
      app.save(rec)
    } catch (err) {
      console.log("REVIEW: event gagal ditulis: " + err)
    }
  }
  function addLedger(app, uid2, amount, source, refId, note) {
    const rec = new Record(app.findCollectionByNameOrId("point_transactions"))
    rec.set("user", uid2)
    rec.set("amount", amount)
    rec.set("source", source)
    rec.set("ref_id", refId || "")
    rec.set("note", note || "")
    app.save(rec)
  }
  function touchStreak(app, uid2) {
    const today = isoDay(new Date())
    let user = null
    try {
      user = app.findRecordById("users", uid2)
    } catch (err) {
      return
    }
    const last = dayOfStored(user.get("last_active_date"))
    if (last === today) return
    let streak = 1
    const y = new Date()
    y.setDate(y.getDate() - 1)
    if (last === isoDay(y)) {
      streak = Math.max(1, (user.get("current_streak") || 0) + 1)
    }
    user.set("current_streak", streak)
    user.set("longest_streak", Math.max(user.get("longest_streak") || 0, streak))
    user.set("last_active_date", pbDate(new Date()))
    app.save(user)
    const every = envInt("STREAK_BONUS_EVERY_DAYS", 6)
    const bonusPts = envInt("STREAK_BONUS_POINTS", 20)
    let bonus = 0
    if (every > 0 && bonusPts > 0 && streak % every === 0) {
      bonus = bonusPts
      addLedger(app, uid2, bonus, "streak", "", "Bonus streak " + streak + " hari berturut-turut")
      notifyUser(
        app,
        uid2,
        "Bonus streak " + streak + " hari!",
        "Konsistensimu terjaga " + streak + " hari — bonus +" + bonus + " poin masuk ke akunmu.",
        "streak",
        { streak: streak, points: bonus }
      )
    }
    addEvent(app, uid2, "streak_hari", { streak: streak, bonus: bonus })
  }
  function syncBadges(app, uid2, delta) {
    // Temuan v0.40: $dbx.exp TIDAK mengikat named params dan .all()/.one()
    // dbx gagal ("must be a pointer") di JSVM — statistik memakai
    // findRecordsByFilter (binding params teruji) + agregasi di JS; volume
    // baris per-user kecil utk skala MVP. Baris yang baru ditulis dalam tx
    // berjalan tidak terlihat oleh query ini — dikompensasi lewat delta.
    const scanRows =
      app.findRecordsByFilter("scans", "user = {:u} && points > 0", "", 0, 0, { u: uid2 }) || []
    const missionRows =
      app.findRecordsByFilter("user_missions", "user = {:u} && status = {:s}", "", 0, 0, {
        u: uid2,
        s: "approved",
      }) || []
    const quizRows =
      app.findRecordsByFilter("user_quiz_attempts", "user = {:u} && passed = true", "", 0, 0, {
        u: uid2,
      }) || []
    const scanCount = scanRows.length + ((delta && delta.scan) || 0)
    const missionDone = missionRows.length + ((delta && delta.mission) || 0)
    const quizPassed = quizRows.length + ((delta && delta.quiz) || 0)
    const user = app.findRecordById("users", uid2)
    const streak = Math.max(user.get("longest_streak") || 0, user.get("current_streak") || 0)
    let pointsEarned = (delta && delta.points) || 0
    const ledgerRows =
      app.findRecordsByFilter("point_transactions", "user = {:u}", "", 0, 0, { u: uid2 }) || []
    for (let li = 0; li < ledgerRows.length; li++) {
      pointsEarned += ledgerRows[li].get("amount") || 0
    }
    function statOf(t) {
      if (t === "scan_count") return scanCount
      if (t === "mission_done") return missionDone
      if (t === "streak") return streak
      if (t === "points_earned") return pointsEarned
      if (t === "quiz_passed") return quizPassed
      return 0
    }
    const owned = {}
    const ownedRows = app.findRecordsByFilter("user_badges", "user = {:u}", "", 0, 0, { u: uid2 }) || []
    for (let i = 0; i < ownedRows.length; i++) {
      owned[String(ownedRows[i].get("badge"))] = true
    }
    const badges = app.findRecordsByFilter("badges", "id != ''", "code", 0, 0) || []
    const earned = []
    for (let i = 0; i < badges.length; i++) {
      const b = badges[i]
      if (owned[String(b.id)]) continue
      const criteria = jsonValue(b.get("criteria"))
      if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) continue
      const t = String(criteria.type || "")
      const target = criteria.value
      if (!t || typeof target !== "number" || !isFinite(target) || target <= 0) continue
      if (statOf(t) < target) continue
      const rec = new Record(app.findCollectionByNameOrId("user_badges"))
      rec.set("user", uid2)
      rec.set("badge", b.id)
      try {
        app.save(rec)
      } catch (err) {
        continue
      }
      earned.push({ code: b.get("code") || "", name: b.get("name") || "" })
      notifyUser(
        app,
        uid2,
        "Lencana baru: " + (b.get("name") || b.get("code") || "lencana"),
        b.get("description") || "Kamu baru saja meraih lencana. Pertahankan!",
        "info",
        { badge_id: b.id, badge_code: b.get("code") || "" }
      )
    }
    return earned
  }

  if (newStatus === "approved") {
    const points = mission.get("points") || 0
    // Catatan semantik (terverifikasi empiris): pada jalur request, efek di
    // hook model SETELAH e.next() TIDAK di-rollback bila hook melempar error
    // sesudahnya (berbeda dgn runInTransaction eksplisit di route klaim/scan
    // yang atomik). Karena itu ledger — efek paling kritis — dijalankan lebih
    // dulu dan gagalnya dilempar; efek sisanya di-catch agar keputusan
    // verifier tetap 200 (badge yang telat ter-cover lazy GET /badges).
    addLedger(e.app, uid, points, "mission", e.record.id, "Misi: " + title)
    try {
      notifyUser(
        e.app,
        uid,
        "Misi disetujui!",
        '"' + title + '" diverifikasi — +' + points + " poin masuk ke akunmu.",
        "mission",
        { claim_id: e.record.id, mission_id: missionId, status: "approved", points: points }
      )
      addEvent(e.app, uid, "misi_selesai", {
        mission_id: missionId,
        points: points,
        claim_id: e.record.id,
      })
      const stReview = touchStreak(e.app, uid)
      syncBadges(e.app, uid, {
        mission: 1,
        points: points + ((stReview && stReview.bonus) || 0),
      })
    } catch (err) {
      console.log("REVIEW: efek non-kritis gagal (badge menyusul via lazy): " + err)
    }
    console.log(
      "MISSION APPROVED claim=" + e.record.id + " user=" + uid + " mission=" + missionId +
        " points=" + points
    )
  } else {
    const note = e.record.get("review_note") || ""
    notifyUser(
      e.app,
      uid,
      "Misi perlu diperbaiki",
      '"' + title + '" ditolak — ' + note + " Kamu bisa unggah ulang bukti di layar Misi.",
      "mission",
      { claim_id: e.record.id, mission_id: missionId, status: "rejected" }
    )
    console.log("MISSION REJECTED claim=" + e.record.id + " user=" + uid + " mission=" + missionId)
  }
}, "user_missions")

// ═════ 6. Hook MODEL scans create — streak, progres auto_scan, badge ═════
// Dipicu juga oleh tulisan internal (route scan, transaksional — sprint 11).
// Aturan (paritas keputusan Sprint 2/5 FastAPI): hanya scan BERNILAI POIN
// (bukan duplikat) yang membuat streak berdetak & misi auto_scan maju.

onRecordCreate((e) => {
  e.next()

  const uid = e.record.get("user")
  const points = e.record.get("points") || 0
  if (!uid || points <= 0) return

  // ── blok bantu (self-contained — duplikasi antar hook DISENGAJA) ──
  function envInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n < 0 ? fallback : n
  }
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }
  function pbDate(d) {
    return isoDay(d) + " 00:00:00.000Z"
  }
  function dayOf(v) {
    // Tanggal LOKAL dari timestamp sistem (created — UTC) atau Date.
    if (!v) return ""
    if (v instanceof Date) return isoDay(v)
    const d = new Date(String(v).replace(" ", "T"))
    return isNaN(d.getTime()) ? String(v).slice(0, 10) : isoDay(d)
  }
  function dayOfStored(v) {
    // Tanggal dari field date yang KITA tulis sbg tanggal-lokal@UTC-tengah
    // malam (last_active_date) — ambil bagian tanggalnya saja (jangan
    // dikonversi ulang lewat zona waktu).
    if (!v) return ""
    return String(v instanceof Date ? v.toISOString() : v).slice(0, 10)
  }
  function momentOf(v) {
    if (!v) return 0
    if (v instanceof Date) return v.getTime()
    const s = String(v).replace(" ", "T")
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z")
    return isNaN(t) ? 0 : t
  }
  function withinWindow(mission, nowMs) {
    const start = momentOf(mission.get("start_at"))
    const end = momentOf(mission.get("end_at"))
    if (start && nowMs < start) return false
    if (end && nowMs > end) return false
    return true
  }
  function periodFor(mission) {
    const d = new Date()
    if ((mission.get("type") || "") === "weekly") {
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    }
    return pbDate(d)
  }
  function jsonValue(raw) {
    if (raw === undefined || raw === null) return null
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw)
      } catch (err) {
        return null
      }
    }
    if (typeof raw === "object" && raw.length !== undefined && typeof raw.count === "undefined") {
      try {
        return JSON.parse(String.fromCharCode.apply(null, raw))
      } catch (err) {
        return null
      }
    }
    return raw
  }
  function notifyUser(app, uid2, ntitle, nbody, ntype, payload) {
    try {
      const rec = new Record(app.findCollectionByNameOrId("notifications"))
      rec.set("user", uid2)
      rec.set("title", ntitle)
      rec.set("body", nbody)
      rec.set("type", ntype)
      rec.set("payload", payload)
      app.save(rec)
    } catch (err) {
      console.log("SCAN PROGRESS: notifikasi gagal ditulis: " + err)
    }
  }
  function addEvent(app, uid2, name, payload) {
    try {
      const rec = new Record(app.findCollectionByNameOrId("analytics_events"))
      rec.set("user", uid2)
      rec.set("name", name)
      rec.set("payload", payload)
      app.save(rec)
    } catch (err) {
      console.log("SCAN PROGRESS: event gagal ditulis: " + err)
    }
  }
  function addLedger(app, uid2, amount, source, refId, note) {
    const rec = new Record(app.findCollectionByNameOrId("point_transactions"))
    rec.set("user", uid2)
    rec.set("amount", amount)
    rec.set("source", source)
    rec.set("ref_id", refId || "")
    rec.set("note", note || "")
    app.save(rec)
  }
  function touchStreak(app, uid2) {
    const today = isoDay(new Date())
    let user = null
    try {
      user = app.findRecordById("users", uid2)
    } catch (err) {
      return
    }
    const last = dayOfStored(user.get("last_active_date"))
    if (last === today) return
    let streak = 1
    const y = new Date()
    y.setDate(y.getDate() - 1)
    if (last === isoDay(y)) {
      streak = Math.max(1, (user.get("current_streak") || 0) + 1)
    }
    user.set("current_streak", streak)
    user.set("longest_streak", Math.max(user.get("longest_streak") || 0, streak))
    user.set("last_active_date", pbDate(new Date()))
    app.save(user)
    const every = envInt("STREAK_BONUS_EVERY_DAYS", 6)
    const bonusPts = envInt("STREAK_BONUS_POINTS", 20)
    let bonus = 0
    if (every > 0 && bonusPts > 0 && streak % every === 0) {
      bonus = bonusPts
      addLedger(app, uid2, bonus, "streak", "", "Bonus streak " + streak + " hari berturut-turut")
      notifyUser(
        app,
        uid2,
        "Bonus streak " + streak + " hari!",
        "Konsistensimu terjaga " + streak + " hari — bonus +" + bonus + " poin masuk ke akunmu.",
        "streak",
        { streak: streak, points: bonus }
      )
    }
    addEvent(app, uid2, "streak_hari", { streak: streak, bonus: bonus })
  }
  function syncBadges(app, uid2, delta) {
    // Temuan v0.40: $dbx.exp TIDAK mengikat named params dan .all()/.one()
    // dbx gagal ("must be a pointer") di JSVM — statistik memakai
    // findRecordsByFilter (binding params teruji) + agregasi di JS; volume
    // baris per-user kecil utk skala MVP. Baris yang baru ditulis dalam tx
    // berjalan tidak terlihat oleh query ini — dikompensasi lewat delta.
    const scanRows =
      app.findRecordsByFilter("scans", "user = {:u} && points > 0", "", 0, 0, { u: uid2 }) || []
    const missionRows =
      app.findRecordsByFilter("user_missions", "user = {:u} && status = {:s}", "", 0, 0, {
        u: uid2,
        s: "approved",
      }) || []
    const quizRows =
      app.findRecordsByFilter("user_quiz_attempts", "user = {:u} && passed = true", "", 0, 0, {
        u: uid2,
      }) || []
    const scanCount = scanRows.length + ((delta && delta.scan) || 0)
    const missionDone = missionRows.length + ((delta && delta.mission) || 0)
    const quizPassed = quizRows.length + ((delta && delta.quiz) || 0)
    const user = app.findRecordById("users", uid2)
    const streak = Math.max(user.get("longest_streak") || 0, user.get("current_streak") || 0)
    let pointsEarned = (delta && delta.points) || 0
    const ledgerRows =
      app.findRecordsByFilter("point_transactions", "user = {:u}", "", 0, 0, { u: uid2 }) || []
    for (let li = 0; li < ledgerRows.length; li++) {
      pointsEarned += ledgerRows[li].get("amount") || 0
    }
    function statOf(t) {
      if (t === "scan_count") return scanCount
      if (t === "mission_done") return missionDone
      if (t === "streak") return streak
      if (t === "points_earned") return pointsEarned
      if (t === "quiz_passed") return quizPassed
      return 0
    }
    const owned = {}
    const ownedRows = app.findRecordsByFilter("user_badges", "user = {:u}", "", 0, 0, { u: uid2 }) || []
    for (let i = 0; i < ownedRows.length; i++) {
      owned[String(ownedRows[i].get("badge"))] = true
    }
    const badges = app.findRecordsByFilter("badges", "id != ''", "code", 0, 0) || []
    const earned = []
    for (let i = 0; i < badges.length; i++) {
      const b = badges[i]
      if (owned[String(b.id)]) continue
      const criteria = jsonValue(b.get("criteria"))
      if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) continue
      const t = String(criteria.type || "")
      const target = criteria.value
      if (!t || typeof target !== "number" || !isFinite(target) || target <= 0) continue
      if (statOf(t) < target) continue
      const rec = new Record(app.findCollectionByNameOrId("user_badges"))
      rec.set("user", uid2)
      rec.set("badge", b.id)
      try {
        app.save(rec)
      } catch (err) {
        continue
      }
      earned.push({ code: b.get("code") || "", name: b.get("name") || "" })
      notifyUser(
        app,
        uid2,
        "Lencana baru: " + (b.get("name") || b.get("code") || "lencana"),
        b.get("description") || "Kamu baru saja meraih lencana. Pertahankan!",
        "info",
        { badge_id: b.id, badge_code: b.get("code") || "" }
      )
    }
    return earned
  }

  // ── 1) streak harian (idempoten per hari; bonus kelipatan env-driven) ──
  const stScan = touchStreak(e.app, uid)

  // ── 2) progres misi auto_scan (paritas apply_scan_progress) ──
  // Catatan v0.40: klaim BARU langsung disimpan dgn status finalnya (satu
  // save) — save lanjutan atas record baru dalam tx yang sama memicu hook
  // update dgn original() kosong (lihat guard review).
  const categoryId = String(e.record.get("category") || "")
  const nowMs = Date.now()
  let autoMissions = []
  try {
    autoMissions =
      e.app.findRecordsByFilter("missions", "verification = {:v} && is_active = {:a}", "", 0, 0, {
        v: "auto_scan",
        a: true,
      }) || []
  } catch (err) {
    autoMissions = []
  }
  // delta badge: scan ini + ledger yang baru ditulis di transaksi berjalan
  let deltaMission = 0
  let deltaPoints = points + ((stScan && stScan.bonus) || 0)
  for (let i = 0; i < autoMissions.length; i++) {
    const m = autoMissions[i]
    if (!withinWindow(m, nowMs)) continue
    const mCat = String(m.get("scan_category") || "")
    if (mCat && mCat !== categoryId) continue
    const period = periodFor(m)
    let claim = null
    try {
      claim = e.app.findFirstRecordByFilter(
        "user_missions",
        "user = {:u} && mission = {:m} && period_date = {:p}",
        { u: uid, m: m.id, p: period }
      )
    } catch (err) {
      claim = null
    }
    if (claim && (claim.get("status") || "") !== "in_progress") continue
    const title = m.get("title") || "Misi"
    const mPoints = m.get("points") || 0
    const required = Math.max(1, m.get("required_count") || 1)
    const progress = ((claim && claim.get("progress_count")) || 0) + 1
    const complete = progress >= required
    if (!claim) {
      // klaim baru: satu save dgn status final (in_progress atau approved)
      claim = new Record(e.app.findCollectionByNameOrId("user_missions"))
      claim.set("user", uid)
      claim.set("mission", m.id)
      claim.set("period_date", period)
      claim.set("progress_count", progress)
      if (complete) {
        claim.set("status", "approved")
        claim.set("points_awarded", mPoints)
        claim.set("reviewed_at", new Date().toISOString())
      } else {
        claim.set("status", "in_progress")
      }
      try {
        e.app.save(claim)
      } catch (err) {
        // balapan dua scan serentak — index UNIQUE menentukan; ambil pemenang
        try {
          claim = e.app.findFirstRecordByFilter(
            "user_missions",
            "user = {:u} && mission = {:m} && period_date = {:p}",
            { u: uid, m: m.id, p: period }
          )
        } catch (err2) {
          claim = null
        }
        if (!claim || (claim.get("status") || "") !== "in_progress") continue
        if (!complete) {
          claim.set("progress_count", progress)
          e.app.save(claim)
          continue
        }
        claim.set("progress_count", progress)
        claim.set("status", "approved")
        claim.set("points_awarded", mPoints)
        claim.set("reviewed_at", new Date().toISOString())
        e.app.save(claim)
      }
    } else {
      claim.set("progress_count", progress)
      if (complete) {
        claim.set("status", "approved")
        claim.set("points_awarded", mPoints)
        claim.set("reviewed_at", new Date().toISOString())
      }
      e.app.save(claim)
    }
    if (!complete) {
      console.log(
        "MISSION AUTO_SCAN progress claim=" + claim.id + " user=" + uid + " mission=" + m.id +
          " " + progress + "/" + required
      )
      continue
    }
    // Target tercapai → selesai otomatis: poin via ledger, notif, event.
    deltaMission += 1
    deltaPoints += mPoints
    addLedger(e.app, uid, mPoints, "mission", claim.id, "Misi auto_scan: " + title)
    notifyUser(
      e.app,
      uid,
      "Misi selesai otomatis!",
      '"' + title + '" tercapai dari scanmu — +' + mPoints + " poin masuk.",
      "mission",
      { claim_id: claim.id, mission_id: m.id, status: "approved", points: mPoints }
    )
    addEvent(e.app, uid, "misi_selesai", {
      mission_id: m.id,
      points: mPoints,
      claim_id: claim.id,
    })
    console.log(
      "MISSION AUTO_SCAN selesai claim=" + claim.id + " user=" + uid + " mission=" + m.id +
        " points=" + mPoints
    )
  }

  // ── 3) badge engine on-event (setelah streak/progres agar statistik segar;
  //       baris tx berjalan tak terlihat countWhere → dikirim sbg delta) ──
  const earned = syncBadges(e.app, uid, { scan: 1, mission: deltaMission, points: deltaPoints })
  if (earned.length > 0) {
    console.log(
      "BADGES earned (scan) user=" + uid + " codes=" + earned.map((b) => b.code).join(",")
    )
  }
}, "scans")

// ═══════════ 7. Guard DELETE missions — jaga riwayat klaim ═══════════

onRecordDeleteRequest((e) => {
  // Temuan v0.40: $dbx.exp tak mengikat params di JSVM → pakai filter API
  // (sintaks filter PB dengan named params — teruji) utk cek keberadaan.
  let claims = 0
  try {
    const rows = e.app.findRecordsByFilter("user_missions", "mission = {:m}", "", 1, 0, {
      m: e.record.id,
    })
    claims = (rows || []).length
  } catch (err) {
    claims = 0
  }
  if (claims > 0) {
    throw new ApiError(409, "Misi sudah punya klaim pengguna — nonaktifkan saja (jaga riwayat).")
  }
  return e.next()
}, "missions")
