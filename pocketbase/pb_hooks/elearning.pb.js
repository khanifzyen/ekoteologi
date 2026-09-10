/// <reference path="../pb_data/types.d.ts" />
// Ekoteologi AR — Sprint 13: E-Learning & konten harian (pb_hooks/elearning.pb.js).
//
// Port `api/app/services/elearning.py` + `api/app/api/elearning.py` +
// `api/app/api/content.py` (arsip fastapi-archive) ke route hook:
//   1. GET  /api/ekoteologi/modules                — daftar modul tayang +
//      progres saya + ringkasan "N/M modul" (header layar Belajar).
//   2. GET  /api/ekoteologi/modules/{id}           — detail: pelajaran urut +
//      intro kuis (tanpa kunci jawaban) + hasil kuis terbaik saya.
//   3. GET  /api/ekoteologi/lessons/{id}           — satu pelajaran (blok
//      konten JSON) + pelajaran berikutnya (CTA lanjut).
//   4. POST /api/ekoteologi/lessons/{id}/complete  — progres berurutan
//      (`lessons_done = max(tercatat, order+1)`); pelajaran terakhir yang
//      menuntaskan modul (transisi) memicu event `modul_selesai` + streak +
//      badge — SEKALI. Tanpa poin dari pelajaran (keputusan Sprint 7).
//   5. GET  /api/ekoteologi/modules/{id}/quiz      — intro kuis + bank soal
//      TANPA kunci jawaban (koleksi quiz_questions terkunci dari baca publik
//      — migrasi sprint 13; menggantikan client-grading yang membocorkan
//      kunci).
//   6. POST /api/ekoteologi/modules/{id}/quiz      — PENILAIAN SERVER-SIDE:
//      kunci tidak pernah ke klien; lulus → attempt + poin SEKALI per modul
//      lewat ledger append-only (anti dobel poin — kuis diulang tetap lulus =
//      0 poin, `already_passed_before`), notifikasi, event `modul_selesai`
//      (source=kuis), streak, badge on-event — satu transaksi. Gagal →
//      attempt tetap tersimpan (riwayat) tanpa poin.
//   7. GET  /api/ekoteologi/daily-content          — konten hari ini
//      (terjadwal admin) atau fallback rotasi bank quote terkurasi (bank yang
//      sama dgn scan — anti-halusinasi); selalu 200 (kartu beranda tak
//      pernah kosong).
//   8. Cron `ekoteologi_daily_publish` (env DAILY_CONTENT_CRON) — auto-
//      publish konten harian dari bank bila admin belum membuat baris utk
//      hari ini (idempoten via unique index publish_date; DAILY_CONTENT_
//      AUTOPUBLISH=0 mematikan) + route trigger manual (admin).
//
// Konfigurasi env: QUIZ_PASS_PERCENT (default 70), QUIZ_POINTS (default 20),
// DAILY_CONTENT_CRON (default "5 0 * * *"), DAILY_CONTENT_AUTOPUBLISH (1).
//
// PENTING — batasan JSVM v0.40 (temuan sprint 9–12, terverifikasi):
//   - handler hook di-stringify ke executor VM pool → closure atas helper
//     top-level TIDAK terbawa. Seluruh helper hidup DI DALAM handler;
//     duplikasi blok bantu antar handler DISENGAJA.
//   - `get()` pada field json mengembalikan array bita JSON → jsonValue().
//   - hitungan koleksi pakai countRecords + $dbx.hashExp (hashExp TERBUKTI
//     jalan; $dbx.exp TIDAK mengikat named params — temuan sprint 12).

// ═══════════════════ 1. GET /api/ekoteologi/modules ═══════════════════

routerAdd("GET", "/api/ekoteologi/modules", (e) => {
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
  function envInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n < 0 ? fallback : n
  }
  const QUIZ_POINTS = envInt("QUIZ_POINTS", 20)

  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }
  const uid = auth.id

  const modules = e.app.findRecordsByFilter("modules", "is_published = {:p}", "order,created", 0, 0, {
    p: true,
  })
  const items = []
  let completed = 0
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i]
    const totalLessons = e.app.countRecords("lessons", $dbx.hashExp({ module: m.id }))
    let questionCount = 0
    let quiz = null
    try {
      quiz = e.app.findFirstRecordByFilter("quizzes", "module = {:m}", { m: m.id })
    } catch (err) {
      quiz = null
    }
    if (quiz) {
      questionCount = e.app.countRecords("quiz_questions", $dbx.hashExp({ quiz: quiz.id }))
    }
    let progress = null
    try {
      progress = e.app.findFirstRecordByFilter(
        "user_module_progress",
        "user = {:u} && module = {:m}",
        { u: uid, m: m.id }
      )
    } catch (err) {
      progress = null
    }
    const lessonsDone = Math.min(progress ? progress.get("lessons_done") || 0 : 0, totalLessons)
    const isCompleted = !!progress && !!progress.get("is_completed")
    const percent =
      totalLessons > 0 ? Math.max(0, Math.min(100, Math.round((lessonsDone / totalLessons) * 100))) : 0
    if (isCompleted) completed++
    let cta = "Mulai"
    if (isCompleted) cta = "Ulangi"
    else if (lessonsDone > 0) cta = "Lanjutkan"
    items.push({
      id: m.id,
      title: m.get("title") || "",
      slug: m.get("slug") || null,
      description: m.get("description") || null,
      cover_url: m.get("cover") || null,
      order: m.get("order") || 0,
      lesson_count: totalLessons,
      quiz_question_count: questionCount,
      quiz_points: questionCount > 0 ? QUIZ_POINTS : 0,
      progress: {
        lessons_done: lessonsDone,
        total_lessons: totalLessons,
        percent: percent,
        is_completed: isCompleted,
      },
      cta: cta,
    })
  }
  return e.json(200, {
    items: items,
    summary: { completed: completed, total: items.length },
  })
}, $apis.requireAuth("users"))

// ═══════════════════ 2. GET /api/ekoteologi/modules/{id} ═══════════════════

routerAdd("GET", "/api/ekoteologi/modules/{id}", (e) => {
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
  function envInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n < 0 ? fallback : n
  }
  const QUIZ_POINTS = envInt("QUIZ_POINTS", 20)
  const PASS_PERCENT = envInt("QUIZ_PASS_PERCENT", 70)

  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }
  const uid = auth.id

  let module = null
  try {
    module = e.app.findRecordById("modules", e.request.pathValue("id"))
  } catch (err) {
    module = null
  }
  if (!module || !module.get("is_published")) {
    throw new ApiError(404, "Modul tidak ditemukan.")
  }

  let progress = null
  try {
    progress = e.app.findFirstRecordByFilter("user_module_progress", "user = {:u} && module = {:m}", {
      u: uid,
      m: module.id,
    })
  } catch (err) {
    progress = null
  }
  const totalLessons = e.app.countRecords("lessons", $dbx.hashExp({ module: module.id }))
  const lessonsDone = Math.min(progress ? progress.get("lessons_done") || 0 : 0, totalLessons)
  const isCompleted = !!progress && !!progress.get("is_completed")
  const percent =
    totalLessons > 0 ? Math.max(0, Math.min(100, Math.round((lessonsDone / totalLessons) * 100))) : 0

  const lessons = e.app.findRecordsByFilter("lessons", "module = {:m}", "order,created", 0, 0, {
    m: module.id,
  })
  const lessonBriefs = []
  for (let i = 0; i < lessons.length; i++) {
    const l = lessons[i]
    const content = jsonValue(l.get("content"))
    lessonBriefs.push({
      id: l.id,
      title: l.get("title") || null,
      order: l.get("order") || i,
      done: (l.get("order") || i) < lessonsDone,
      block_count: Array.isArray(content) ? content.length : 0,
    })
  }

  let quizOut = null
  let quizBest = null
  let quiz = null
  try {
    quiz = e.app.findFirstRecordByFilter("quizzes", "module = {:m}", { m: module.id })
  } catch (err) {
    quiz = null
  }
  if (quiz) {
    const questions = e.app.findRecordsByFilter("quiz_questions", "quiz = {:q}", "order,created", 0, 0, {
      q: quiz.id,
    })
    if (questions.length > 0) {
      const qItems = []
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i]
        const options = jsonValue(q.get("options"))
        qItems.push({
          id: q.id,
          question: q.get("question") || "",
          options: Array.isArray(options) ? options.map(function (o) {
            return String(o)
          }) : [],
        })
      }
      quizOut = {
        id: quiz.id,
        question_count: questions.length,
        pass_percent: PASS_PERCENT,
        points: QUIZ_POINTS,
        // KUNCI JAWABAN TIDAK PERNAH ke klien (dinilai server).
        questions: qItems,
      }
      // Hasil kuis terbaik saya (skor tertinggi; seri → yang terbaru).
      let attempts = []
      try {
        attempts =
          e.app.findRecordsByFilter(
            "user_quiz_attempts",
            "user = {:u} && quiz = {:q}",
            "-created",
            0,
            0,
            { u: uid, q: quiz.id }
          ) || []
      } catch (err) {
        attempts = []
      }
      let best = null
      for (let i = 0; i < attempts.length; i++) {
        const a = attempts[i]
        if (!best || (a.get("score") || 0) > (best.get("score") || 0)) best = a
      }
      if (best && (best.get("total") || 0) > 0) {
        const score = best.get("score") || 0
        const total = best.get("total") || 0
        quizBest = {
          score: score,
          total: total,
          percent: Math.round((score / total) * 100),
          passed: !!best.get("passed"),
          points_awarded: best.get("points_awarded") || 0,
        }
      }
    }
  }

  return e.json(200, {
    id: module.id,
    title: module.get("title") || "",
    slug: module.get("slug") || null,
    description: module.get("description") || null,
    cover_url: module.get("cover") || null,
    order: module.get("order") || 0,
    progress: {
      lessons_done: lessonsDone,
      total_lessons: totalLessons,
      percent: percent,
      is_completed: isCompleted,
    },
    lessons: lessonBriefs,
    quiz: quizOut,
    quiz_best: quizBest,
  })
}, $apis.requireAuth("users"))

// ═══════════════════ 3. GET /api/ekoteologi/lessons/{id} ═══════════════════

routerAdd("GET", "/api/ekoteologi/lessons/{id}", (e) => {
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

  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }
  const uid = auth.id

  let lesson = null
  try {
    lesson = e.app.findRecordById("lessons", e.request.pathValue("id"))
  } catch (err) {
    lesson = null
  }
  let module = null
  if (lesson) {
    try {
      module = e.app.findRecordById("modules", lesson.get("module"))
    } catch (err) {
      module = null
    }
  }
  if (!lesson || !module || !module.get("is_published")) {
    throw new ApiError(404, "Pelajaran tidak ditemukan.")
  }

  const siblings = e.app.findRecordsByFilter("lessons", "module = {:m}", "order,created", 0, 0, {
    m: module.id,
  })
  let progress = null
  try {
    progress = e.app.findFirstRecordByFilter("user_module_progress", "user = {:u} && module = {:m}", {
      u: uid,
      m: module.id,
    })
  } catch (err) {
    progress = null
  }
  const lessonsDone = Math.min(progress ? progress.get("lessons_done") || 0 : 0, siblings.length)

  let position = -1
  for (let i = 0; i < siblings.length; i++) {
    if (siblings[i].id === lesson.id) {
      position = i
      break
    }
  }
  const nextLesson = position >= 0 && position + 1 < siblings.length ? siblings[position + 1] : null

  return e.json(200, {
    id: lesson.id,
    module_id: module.id,
    module_title: module.get("title") || "",
    title: lesson.get("title") || null,
    order: position >= 0 ? position : 0,
    total_lessons: siblings.length,
    blocks: jsonValue(lesson.get("content")) || [],
    done: (lesson.get("order") || 0) < lessonsDone,
    next_lesson_id: nextLesson ? nextLesson.id : null,
  })
}, $apis.requireAuth("users"))

// ═══════════════ 4. POST /api/ekoteologi/lessons/{id}/complete ═══════════════

routerAdd("POST", "/api/ekoteologi/lessons/{id}/complete", (e) => {
  // ── blok bantu (self-contained — duplikasi antar handler DISENGAJA) ──
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
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }
  function pbDate(d) {
    return isoDay(d) + " 00:00:00.000Z"
  }
  function dayOfStored(v) {
    if (!v) return ""
    return String(v instanceof Date ? v.toISOString() : v).slice(0, 10)
  }
  function envInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n < 0 ? fallback : n
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
      console.log("LESSON: notifikasi gagal ditulis: " + err)
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
      console.log("LESSON: event gagal ditulis: " + err)
    }
  }
  function touchStreak(app, uid2) {
    const today = isoDay(new Date())
    let user = null
    try {
      user = app.findRecordById("users", uid2)
    } catch (err) {
      return { bonus: 0 }
    }
    const last = dayOfStored(user.get("last_active_date"))
    if (last === today) return { bonus: 0 }
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
      const rec = new Record(app.findCollectionByNameOrId("point_transactions"))
      rec.set("user", uid2)
      rec.set("amount", bonus)
      rec.set("source", "streak")
      rec.set("ref_id", "")
      rec.set("note", "Bonus streak " + streak + " hari berturut-turut")
      app.save(rec)
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
    return { bonus: bonus }
  }
  function syncBadges(app, uid2, delta) {
    function jsonValue2(raw) {
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
    // Temuan v0.40: baris yang baru ditulis dalam tx berjalan tidak terlihat
    // oleh query — dikompensasi lewat delta (pola sprint 12).
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
      const criteria = jsonValue2(b.get("criteria"))
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
        continue // idempoten — balapan unique index
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

  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }
  const uid = auth.id

  let lesson = null
  try {
    lesson = e.app.findRecordById("lessons", e.request.pathValue("id"))
  } catch (err) {
    lesson = null
  }
  let module = null
  if (lesson) {
    try {
      module = e.app.findRecordById("modules", lesson.get("module"))
    } catch (err) {
      module = null
    }
  }
  if (!lesson || !module || !module.get("is_published")) {
    throw new ApiError(404, "Pelajaran tidak ditemukan.")
  }

  const totalLessons = e.app.countRecords("lessons", $dbx.hashExp({ module: module.id }))
  const lessonOrder = lesson.get("order") || 0

  let result = null
  e.app.runInTransaction(function (txApp) {
    let progress = null
    try {
      progress = txApp.findFirstRecordByFilter(
        "user_module_progress",
        "user = {:u} && module = {:m}",
        { u: uid, m: module.id }
      )
    } catch (err) {
      progress = null
    }
    const current = progress ? progress.get("lessons_done") || 0 : 0
    const wasCompleted = !!progress && !!progress.get("is_completed")
    // Progres berurutan: pelajaran ke-N selesai ⇒ N pelajaran beres; membaca
    // ulang pelajaran lama tidak menurunkan/menggandakan progres.
    const lessonsDone = Math.max(current, lessonOrder + 1)
    const justCompleted = !wasCompleted && totalLessons > 0 && lessonsDone >= totalLessons

    if (!progress) {
      progress = new Record(txApp.findCollectionByNameOrId("user_module_progress"))
      progress.set("user", uid)
      progress.set("module", module.id)
    }
    progress.set("lessons_done", lessonsDone)
    progress.set("is_completed", wasCompleted || (totalLessons > 0 && lessonsDone >= totalLessons))
    if (justCompleted) progress.set("completed_at", new Date().toISOString())
    txApp.save(progress)

    if (justCompleted) {
      addEvent(txApp, uid, "modul_selesai", {
        module_id: module.id,
        source: "pelajaran",
      })
      const st = touchStreak(txApp, uid)
      syncBadges(txApp, uid, { points: (st && st.bonus) || 0 })
    }
    const percent =
      totalLessons > 0
        ? Math.max(0, Math.min(100, Math.round((lessonsDone / totalLessons) * 100)))
        : 0
    result = {
      lessons_done: lessonsDone,
      total_lessons: totalLessons,
      percent: percent,
      is_completed: !!progress.get("is_completed"),
      just_completed: justCompleted,
      message: justCompleted
        ? "MasyaAllah! Modul ini tuntas — lanjutkan ke kuisnya untuk poin."
        : "Pelajaran ditandai selesai.",
    }
  })

  // Audit manual (tulisan internal tidak memicu hook request — pola sprint 11).
  try {
    const col = e.app.findCollectionByNameOrId("audit_logs")
    const recAudit = new Record(col)
    recAudit.set("actor", uid)
    recAudit.set("action", "lesson_complete")
    recAudit.set("entity", "user_module_progress")
    recAudit.set("entity_id", module.id)
    recAudit.set("diff", {
      lesson_id: lesson.id,
      lessons_done: result.lessons_done,
      total_lessons: result.total_lessons,
      just_completed: result.just_completed,
      _actor: "user",
    })
    e.app.save(recAudit)
  } catch (err) {
    console.log("LESSON: audit gagal menulis: " + err)
  }
  console.log(
    "LESSON COMPLETE user=" + uid + " module=" + module.id + " lesson=" + lesson.id +
      " done=" + result.lessons_done + "/" + result.total_lessons +
      " just_completed=" + result.just_completed
  )
  return e.json(200, result)
}, $apis.requireAuth("users"))

// ═══════════════ 5. GET /api/ekoteologi/modules/{id}/quiz ═══════════════

routerAdd("GET", "/api/ekoteologi/modules/{id}/quiz", (e) => {
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
  function envInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n < 0 ? fallback : n
  }
  const QUIZ_POINTS = envInt("QUIZ_POINTS", 20)
  const PASS_PERCENT = envInt("QUIZ_PASS_PERCENT", 70)

  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }

  let module = null
  try {
    module = e.app.findRecordById("modules", e.request.pathValue("id"))
  } catch (err) {
    module = null
  }
  if (!module || !module.get("is_published")) {
    throw new ApiError(404, "Modul tidak ditemukan.")
  }
  let quiz = null
  try {
    quiz = e.app.findFirstRecordByFilter("quizzes", "module = {:m}", { m: module.id })
  } catch (err) {
    quiz = null
  }
  if (!quiz) {
    throw new ApiError(404, "Modul ini belum memiliki kuis.")
  }
  const questions = e.app.findRecordsByFilter("quiz_questions", "quiz = {:q}", "order,created", 0, 0, {
    q: quiz.id,
  })
  if (questions.length === 0) {
    throw new ApiError(404, "Kuis modul ini belum memiliki soal.")
  }
  const qItems = []
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const options = jsonValue(q.get("options"))
    qItems.push({
      id: q.id,
      question: q.get("question") || "",
      options: Array.isArray(options) ? options.map(function (o) {
        return String(o)
      }) : [],
    })
  }
  return e.json(200, {
    id: quiz.id,
    question_count: questions.length,
    pass_percent: PASS_PERCENT,
    points: QUIZ_POINTS,
    questions: qItems,
  })
}, $apis.requireAuth("users"))

// ═══════════════ 6. POST /api/ekoteologi/modules/{id}/quiz ═══════════════
// Penilaian otomatis SERVER-SIDE (kunci tidak pernah ke klien) + poin SEKALI
// per modul (anti dobel — keputusan lintas sprint). Satu transaksi:
// attempt → ledger → notifikasi → event → streak → badge.

routerAdd("POST", "/api/ekoteologi/modules/{id}/quiz", (e) => {
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
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }
  function pbDate(d) {
    return isoDay(d) + " 00:00:00.000Z"
  }
  function dayOfStored(v) {
    if (!v) return ""
    return String(v instanceof Date ? v.toISOString() : v).slice(0, 10)
  }
  function envInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n < 0 ? fallback : n
  }
  const QUIZ_POINTS = envInt("QUIZ_POINTS", 20)
  const PASS_PERCENT = envInt("QUIZ_PASS_PERCENT", 70)

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
      console.log("QUIZ: notifikasi gagal ditulis: " + err)
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
      console.log("QUIZ: event gagal ditulis: " + err)
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
      return { bonus: 0 }
    }
    const last = dayOfStored(user.get("last_active_date"))
    if (last === today) return { bonus: 0 }
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
    return { bonus: bonus }
  }
  function syncBadges(app, uid2, delta) {
    function jsonValue2(raw) {
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
      const criteria = jsonValue2(b.get("criteria"))
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

  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }
  const uid = auth.id

  let module = null
  try {
    module = e.app.findRecordById("modules", e.request.pathValue("id"))
  } catch (err) {
    module = null
  }
  if (!module || !module.get("is_published")) {
    throw new ApiError(404, "Modul tidak ditemukan.")
  }
  let quiz = null
  try {
    quiz = e.app.findFirstRecordByFilter("quizzes", "module = {:m}", { m: module.id })
  } catch (err) {
    quiz = null
  }
  if (!quiz) {
    throw new ApiError(404, "Modul ini belum memiliki kuis.")
  }
  const questions = e.app.findRecordsByFilter("quiz_questions", "quiz = {:q}", "order,created", 0, 0, {
    q: quiz.id,
  })
  if (questions.length === 0) {
    throw new ApiError(404, "Kuis modul ini belum memiliki soal.")
  }

  // ── cocokkan jawaban dgn soal kuis ini (soal tak dikenal diabaikan) ──
  const body = e.requestInfo().body || {}
  const rawAnswers = Array.isArray(body.answers) ? body.answers : []
  const qById = {}
  for (let i = 0; i < questions.length; i++) {
    qById[String(questions[i].id)] = questions[i]
  }
  const answers = {}
  let answerCount = 0
  for (let i = 0; i < rawAnswers.length; i++) {
    const a = rawAnswers[i] || {}
    const qid = String(a.question_id || "")
    if (!qById[qid]) continue
    const choice = typeof a.choice === "number" ? a.choice : parseInt(a.choice, 10)
    answers[qid] = isNaN(choice) ? null : choice
    answerCount++
  }
  if (answerCount === 0) {
    throw new ApiError(400, "Jawaban tidak cocok dengan soal kuis ini.")
  }

  // ── penilaian (murni — port grade_quiz + with_threshold) ──
  let score = 0
  const review = []
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const choice = answers[String(q.id)] === undefined ? null : answers[String(q.id)]
    const answer = q.get("answer") || 0
    const correct = choice !== null && choice === answer
    if (correct) score++
    review.push({
      question_id: q.id,
      question: q.get("question") || "",
      choice: choice,
      answer: answer,
      correct: correct,
      explanation: q.get("explanation") || null,
    })
  }
  const total = questions.length
  const percent = Math.max(0, Math.min(100, Math.round((score / total) * 100)))
  const passed = total > 0 && percent >= PASS_PERCENT

  // Anti dobel poin: pernah LULUS kuis modul ini sebelumnya?
  let alreadyPassed = false
  try {
    e.app.findFirstRecordByFilter(
      "user_quiz_attempts",
      "user = {:u} && quiz = {:q} && passed = {:p}",
      { u: uid, q: quiz.id, p: true }
    )
    alreadyPassed = true
  } catch (err) {
    alreadyPassed = false
  }

  const pointsAwarded = passed && !alreadyPassed ? QUIZ_POINTS : 0
  const moduleTitle = module.get("title") || "Modul"
  let attemptId = ""
  let pointsTotal = 0

  e.app.runInTransaction(function (txApp) {
    const attempt = new Record(txApp.findCollectionByNameOrId("user_quiz_attempts"))
    attempt.set("user", uid)
    attempt.set("quiz", quiz.id)
    attempt.set("score", score)
    attempt.set("total", total)
    const answersOut = []
    for (let i = 0; i < rawAnswers.length; i++) {
      const a = rawAnswers[i] || {}
      if (!qById[String(a.question_id || "")]) continue
      const choice = typeof a.choice === "number" ? a.choice : parseInt(a.choice, 10)
      answersOut.push({ question_id: String(a.question_id), choice: isNaN(choice) ? null : choice })
    }
    attempt.set("answers", answersOut)
    attempt.set("points_awarded", pointsAwarded)
    attempt.set("passed", passed)
    txApp.save(attempt)
    attemptId = attempt.id

    if (pointsAwarded > 0) {
      // Ledger append-only — hook MODEL (scan.pb.js) menyinkronkan
      // users.points + level dalam transaksi yang sama (atomik).
      addLedger(txApp, uid, pointsAwarded, "quiz", attempt.id, "Kuis modul: " + moduleTitle)
      notifyUser(
        txApp,
        uid,
        "Poin kuis masuk",
        'Kuis "' + moduleTitle + '" lulus (' + percent + "%) — +" + pointsAwarded + " poin masuk ke akunmu.",
        "info",
        { module_id: module.id, quiz_id: quiz.id, points: pointsAwarded, attempt_id: attempt.id }
      )
      addEvent(txApp, uid, "modul_selesai", {
        module_id: module.id,
        quiz_id: quiz.id,
        score: score,
        total: total,
        source: "kuis",
      })
      const st = touchStreak(txApp, uid)
      syncBadges(txApp, uid, { quiz: 1, points: pointsAwarded + ((st && st.bonus) || 0) })
    }
  })

  try {
    pointsTotal = e.app.findRecordById("users", uid).get("points") || 0
  } catch (err) {
    pointsTotal = 0
  }

  // Audit manual (pola sprint 11 — tulisan internal tak memicu hook request).
  try {
    const col = e.app.findCollectionByNameOrId("audit_logs")
    const recAudit = new Record(col)
    recAudit.set("actor", uid)
    recAudit.set("action", "quiz_submit")
    recAudit.set("entity", "user_quiz_attempts")
    recAudit.set("entity_id", attemptId)
    recAudit.set("diff", {
      module_id: module.id,
      quiz_id: quiz.id,
      score: score,
      total: total,
      percent: percent,
      passed: passed,
      points_awarded: pointsAwarded,
      already_passed_before: alreadyPassed,
      _actor: "user",
    })
    e.app.save(recAudit)
  } catch (err) {
    console.log("QUIZ: audit gagal menulis: " + err)
  }
  console.log(
    "QUIZ SUBMIT user=" + uid + " module=" + module.id + " score=" + score + "/" + total +
      " passed=" + passed + " points=" + pointsAwarded
  )

  let message = ""
  if (!passed) {
    message =
      "Belum lulus — pelajari kembali materinya lalu coba lagi. Poin menunggumu di percobaan berikutnya."
  } else if (pointsAwarded > 0) {
    message = "MasyaAllah, Lulus! +" + pointsAwarded + " poin masuk ke dompet kebaikanmu."
  } else {
    message = "MasyaAllah, Lulus! Kamu sudah meraih poin kuis modul ini sebelumnya."
  }
  return e.json(200, {
    score: score,
    total: total,
    percent: percent,
    passed: passed,
    pass_percent: PASS_PERCENT,
    points_awarded: pointsAwarded,
    points_total: pointsTotal,
    already_passed_before: alreadyPassed,
    message: message,
    review: review,
  })
}, $apis.requireAuth("users"))

// ═══════════════ 7. GET /api/ekoteologi/daily-content ═══════════════
// Port `api/app/api/content.py` + `services/quotes.py` (fallback rotasi bank
// terkurasi — anti-halusinasi, satu sumber dgn scan). Selalu 200.

routerAdd("GET", "/api/ekoteologi/daily-content", (e) => {
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }
  function pbDate(d) {
    return isoDay(d) + " 00:00:00.000Z"
  }
  function dayOfYear(d) {
    const start = new Date(d.getFullYear(), 0, 0)
    return Math.floor((d - start) / 86400000)
  }
  // Bank quote terkurasi (port services/quotes.py — 7 kategori + fallback umum).
  const QUOTE_BANK = [
    { type: "ayat", body: "Dia menciptakan kamu dari bumi dan memakmurkannya (meminta kamu memakmurnya).", source: "QS Hud: 61" },
    { type: "ayat", body: "Sesungguhnya Allah tidak menyukai orang yang berlebih-lebihan (berbuat rusak).", source: "QS Al-An'am: 141" },
    { type: "hadis", body: "Tidaklah seorang muslim menanam pohon lalu darinya dimakan burung, manusia, atau hewan, melainkan itu menjadi sedekah baginya.", source: "HR Bukhari no. 2320" },
    { type: "ayat", body: "Allah adalah cahaya langit dan bumi. Perumpamaan cahaya-Nya seperti sebuah cermin (mishkah) di dalamnya ada lampu.", source: "QS An-Nur: 35" },
    { type: "ayat", body: "Dan sungguh Kami telah mengirim besi yang padanya terdapat kekuatan hebat dan berbagai manfaat bagi manusia.", source: "QS Al-Hadid: 25" },
    { type: "ayat", body: "Janganlah kamu berbuat kerusakan di bumi setelah (diciptakan) dengan baik.", source: "QS Al-A'raf: 56" },
    { type: "hadis", body: "Iman itu ada tujuh puluh sekian cabang; yang tertinggi adalah laa ilaaha illallah, dan yang terendah adalah menyingkirkan gangguan dari jalan.", source: "HR Muslim no. 35" },
    { type: "hadis", body: "Dunia itu hijau dan manis; sungguh Allah menjadikan kalian khalifah di dalamnya, maka perhatikanlah bagaimana kalian berbuat.", source: "HR Muslim no. 2742" },
  ]

  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }
  const now = new Date()
  const today = pbDate(now)
  let content = null
  try {
    content = e.app.findFirstRecordByFilter("daily_contents", "publish_date = {:d}", { d: today })
  } catch (err) {
    content = null
  }
  if (content) {
    return e.json(200, {
      date: today.slice(0, 10),
      type: content.get("type") || "refleksi",
      title: content.get("title") || null,
      body: content.get("body") || "",
      source: content.get("source") || null,
      eco_action: content.get("eco_action") || null,
      fallback: false,
    })
  }
  // Rotasi deterministik per tanggal (hari sama = kutipan sama di semua server).
  const pick = QUOTE_BANK[dayOfYear(now) % QUOTE_BANK.length]
  return e.json(200, {
    date: today.slice(0, 10),
    type: "fallback",
    title: null,
    body: pick.body,
    source: pick.source,
    eco_action: null,
    fallback: true,
  })
}, $apis.requireAuth("users"))

// ═════════ 8. Cron auto-publish konten harian + trigger manual ═════════
// Bila admin belum membuat baris utk hari ini, terbitkan satu dari bank
// rotasi (idempoten — unique index publish_date; DAILY_CONTENT_AUTOPUBLISH=0
// mematikan). Kartu wisdom beranda tidak pernah kosong tanpa jadwal admin.

// Handler cron & route trigger memakai blok bantu yang sama — JSVM tidak
// meneruskan closure top-level ke handler, maka blok diduplikasi (disengaja).

cronAdd("ekoteologi_daily_publish", $os.getenv("DAILY_CONTENT_CRON") || "5 0 * * *", () => {
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }
  function pbDate(d) {
    return isoDay(d) + " 00:00:00.000Z"
  }
  function dayOfYear(d) {
    const start = new Date(d.getFullYear(), 0, 0)
    return Math.floor((d - start) / 86400000)
  }
  const BANK = [
    { type: "ayat", body: "Dia menciptakan kamu dari bumi dan memakmurkannya (meminta kamu memakmurnya).", source: "QS Hud: 61" },
    { type: "ayat", body: "Sesungguhnya Allah tidak menyukai orang yang berlebih-lebihan (berbuat rusak).", source: "QS Al-An'am: 141" },
    { type: "hadis", body: "Tidaklah seorang muslim menanam pohon lalu darinya dimakan burung, manusia, atau hewan, melainkan itu menjadi sedekah baginya.", source: "HR Bukhari no. 2320" },
    { type: "ayat", body: "Allah adalah cahaya langit dan bumi. Perumpamaan cahaya-Nya seperti sebuah cermin (mishkah) di dalamnya ada lampu.", source: "QS An-Nur: 35" },
    { type: "ayat", body: "Dan sungguh Kami telah mengirim besi yang padanya terdapat kekuatan hebat dan berbagai manfaat bagi manusia.", source: "QS Al-Hadid: 25" },
    { type: "ayat", body: "Janganlah kamu berbuat kerusakan di bumi setelah (diciptakan) dengan baik.", source: "QS Al-A'raf: 56" },
    { type: "hadis", body: "Iman itu ada tujuh puluh sekian cabang; yang tertinggi adalah laa ilaaha illallah, dan yang terendah adalah menyingkirkan gangguan dari jalan.", source: "HR Muslim no. 35" },
    { type: "hadis", body: "Dunia itu hijau dan manis; sungguh Allah menjadikan kalian khalifah di dalamnya, maka perhatikanlah bagaimana kalian berbuat.", source: "HR Muslim no. 2742" },
  ]
  const ECO_ACTIONS = [
    "Pilah satu kantong sampah plastikmu hari ini.",
    "Bawa tumbler sendiri — tolak satu gelas plastik.",
    "Matikan listrik di ruang yang tidak dipakai hari ini.",
    "Hemat air: tutup keran saat berwudhu.",
    "Ayo jalan kaki atau naik transportasi umum sekali hari ini.",
    "Tanam atau rawat satu tanaman di rumahmu.",
  ]
  let created = 0
  let skipped = false
  if (($os.getenv("DAILY_CONTENT_AUTOPUBLISH") || "1") === "0") {
    skipped = true
  } else {
    const now = new Date()
    const today = pbDate(now)
    let exists = false
    try {
      $app.findFirstRecordByFilter("daily_contents", "publish_date = {:d}", { d: today })
      exists = true // sudah ada jadwal admin — jangan sentuh
    } catch (err) {
      exists = false
    }
    if (!exists) {
      const doy = dayOfYear(now)
      const pick = BANK[doy % BANK.length]
      const rec = new Record($app.findCollectionByNameOrId("daily_contents"))
      rec.set("publish_date", today)
      rec.set("type", pick.type)
      rec.set("title", "")
      rec.set("body", pick.body)
      rec.set("source", pick.source)
      rec.set("eco_action", ECO_ACTIONS[doy % ECO_ACTIONS.length])
      try {
        $app.save(rec)
        created = 1
        console.log("CRON daily publish: konten terbit utk " + today.slice(0, 10))
      } catch (err) {
        // balapan unik — cron lain lebih dulu (idempoten)
        console.log("CRON daily publish: lewati (" + err + ")")
      }
    }
  }
  console.log(
    "CRON ekoteologi_daily_publish: created=" + created + " skipped=" + skipped
  )
})

routerAdd("POST", "/api/ekoteologi/cron/daily-content", (e) => {
  const auth = e.auth
  if (!auth || auth.collection().name !== "users" || auth.get("role") !== "admin") {
    throw new UnauthorizedError("Hanya admin yang dapat memicu publish konten harian.")
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
  function dayOfYear(d) {
    const start = new Date(d.getFullYear(), 0, 0)
    return Math.floor((d - start) / 86400000)
  }
  const BANK = [
    { type: "ayat", body: "Dia menciptakan kamu dari bumi dan memakmurkannya (meminta kamu memakmurnya).", source: "QS Hud: 61" },
    { type: "ayat", body: "Sesungguhnya Allah tidak menyukai orang yang berlebih-lebihan (berbuat rusak).", source: "QS Al-An'am: 141" },
    { type: "hadis", body: "Tidaklah seorang muslim menanam pohon lalu darinya dimakan burung, manusia, atau hewan, melainkan itu menjadi sedekah baginya.", source: "HR Bukhari no. 2320" },
    { type: "ayat", body: "Allah adalah cahaya langit dan bumi. Perumpamaan cahaya-Nya seperti sebuah cermin (mishkah) di dalamnya ada lampu.", source: "QS An-Nur: 35" },
    { type: "ayat", body: "Dan sungguh Kami telah mengirim besi yang padanya terdapat kekuatan hebat dan berbagai manfaat bagi manusia.", source: "QS Al-Hadid: 25" },
    { type: "ayat", body: "Janganlah kamu berbuat kerusakan di bumi setelah (diciptakan) dengan baik.", source: "QS Al-A'raf: 56" },
    { type: "hadis", body: "Iman itu ada tujuh puluh sekian cabang; yang tertinggi adalah laa ilaaha illallah, dan yang terendah adalah menyingkirkan gangguan dari jalan.", source: "HR Muslim no. 35" },
    { type: "hadis", body: "Dunia itu hijau dan manis; sungguh Allah menjadikan kalian khalifah di dalamnya, maka perhatikanlah bagaimana kalian berbuat.", source: "HR Muslim no. 2742" },
  ]
  const ECO_ACTIONS = [
    "Pilah satu kantong sampah plastikmu hari ini.",
    "Bawa tumbler sendiri — tolak satu gelas plastik.",
    "Matikan listrik di ruang yang tidak dipakai hari ini.",
    "Hemat air: tutup keran saat berwudhu.",
    "Ayo jalan kaki atau naik transportasi umum sekali hari ini.",
    "Tanam atau rawat satu tanaman di rumahmu.",
  ]
  let created = 0
  let skipped = false
  if (($os.getenv("DAILY_CONTENT_AUTOPUBLISH") || "1") === "0") {
    skipped = true
  } else {
    const now = new Date()
    const today = pbDate(now)
    let exists = false
    try {
      e.app.findFirstRecordByFilter("daily_contents", "publish_date = {:d}", { d: today })
      exists = true
    } catch (err) {
      exists = false
    }
    if (!exists) {
      const doy = dayOfYear(now)
      const pick = BANK[doy % BANK.length]
      const rec = new Record(e.app.findCollectionByNameOrId("daily_contents"))
      rec.set("publish_date", today)
      rec.set("type", pick.type)
      rec.set("title", "")
      rec.set("body", pick.body)
      rec.set("source", pick.source)
      rec.set("eco_action", ECO_ACTIONS[doy % ECO_ACTIONS.length])
      try {
        e.app.save(rec)
        created = 1
      } catch (err) {
        console.log("DAILY PUBLISH: lewati (" + err + ")")
      }
    }
  }
  return e.json(200, {
    created: created,
    skipped: skipped,
    date: isoDay(new Date()),
  })
}, $apis.requireAuth("users"))
