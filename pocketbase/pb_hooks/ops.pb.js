/// <reference path="../pb_data/types.d.ts" />
// Ekoteologi AR — Sprint 13: hardening & ops (pb_hooks/ops.pb.js).
//
//   1. GET /api/ekoteologi/admin/dashboard (staff) — agregasi KPI + chart
//      pengganti `GET /v1/admin/kpi` + `/v1/admin/charts` FastAPI:
//      pengguna, scan, antrian verifikasi, cache hit rate, token/biaya LLM
//      bulan berjalan, scan harian 14 hari, komposisi kategori 7 hari.
//      CATATAN v0.40 (temuan sprint 12, diverifikasi ulang sprint 13): SQL
//      `$app.db().newQuery(...).bind(...).all()` GAGAL di JSVM ("Invalid
//      variable type: must be a pointer") — agregasi memakai
//      findRecordsByFilter (binding params teruji) + hitung di JS; skala MVP
//      (baris per-jendela waktu kecil-ratusan) aman, diamati ke depan.
//   2. Cron `ekoteologi_cleanup` (env CLEANUP_CRON, default "30 3 * * *") —
//      pembersihan kunci `app_settings` kedaluwarsa (`sr:*`, `scan_quota:*`,
//      `sd:*`, guard login korup/lewat jendela, cache token FCM — catatan
//      sprint 11–12) + entri `llm_cache` yang `expires`-nya lewat; idempoten.
//      Trigger manual: POST /api/ekoteologi/cron/cleanup (admin).
//   3. POST /api/ekoteologi/cron/backup (admin) — cadangan `pb_data` on
//      demand (`$app.createBackup(new Context(), nama)`); jadwal otomatis
//      memakai fitur bawaan PB (migrasi sprint 13: settings.backups.cron
//      dari env BACKUP_CRON, retensi BACKUP_KEEP) — hasil terbaca di
//      `/api/backups` (superuser) dan dasbor PB.
//   4. Error hook — middleware `routerUse` menangkap error TAK TERDUGA dari
//      seluruh route (tanpa status / status ≥ 500; error bisnis 4xx tidak
//      dilaporkan) → kirim ke Sentry (env SENTRY_DSN — store endpoint via
//      $http.send; tanpa DSN cukup PB logs) lalu diteruskan agar respons
//      klien tidak berubah. Tubuh cron memakai reporter yang sama (cron tak
//      melewati router).
//
// PENTING — batasan JSVM v0.40: seluruh helper DI DALAM handler/hook
// (closure top-level tidak terbawa ke executor pool); duplikasi DISENGAJA.

// ═══════════════ 1. GET /api/ekoteologi/admin/dashboard ═══════════════

routerAdd("GET", "/api/ekoteologi/admin/dashboard", (e) => {
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
  function dayOf(v) {
    // Tanggal LOKAL dari timestamp sistem (created — UTC) atau Date.
    if (!v) return ""
    if (v instanceof Date) return isoDay(v)
    const d = new Date(String(v).replace(" ", "T"))
    return isNaN(d.getTime()) ? String(v).slice(0, 10) : isoDay(d)
  }
  function isoAgo(days) {
    const d = new Date()
    d.setDate(d.getDate() - days)
    return d.toISOString()
  }

  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }
  const role = auth.get("role") || ""
  if (role !== "admin" && role !== "verifier" && role !== "editor") {
    throw new UnauthorizedError("Hanya staff (admin/verifier/editor) yang dapat membuka dashboard.")
  }

  // ── pengguna ──
  const usersTotal = e.app.countRecords("users")
  let usersNew7d = 0
  try {
    usersNew7d = (e.app.findRecordsByFilter("users", "created >= {:c}", "", 0, 0, { c: isoAgo(7) }) || [])
      .length
  } catch (err) {
    usersNew7d = 0
  }

  // ── scan: satu query bulan berjalan utk semua jendela (hari/7/14 hari) ──
  const scansTotal = e.app.countRecords("scans")
  const today = isoDay(new Date())
  let scansToday = 0
  let monthScans = []
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  try {
    monthScans =
      e.app.findRecordsByFilter("scans", "created >= {:c}", "created", 0, 0, {
        c: monthStart.toISOString(),
      }) || []
  } catch (err) {
    monthScans = []
  }
  const weekStartIso = isoAgo(7)
  let weekScans = []
  const dailyByDate = {}
  for (let i = 0; i < monthScans.length; i++) {
    const created = monthScans[i].get("created")
    const createdIso = created instanceof Date ? created.toISOString() : String(created)
    if (createdIso >= weekStartIso) weekScans.push(monthScans[i])
    const day = dayOf(created)
    if (day === today) scansToday++
    dailyByDate[day] = (dailyByDate[day] || 0) + 1
  }
  const CHART_DAYS = 14
  const daily = []
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const day = isoDay(d)
    daily.push({ date: day, count: dailyByDate[day] || 0 })
  }

  // ── komposisi kategori 7 hari (join di JS — temuan $dbx) ──
  const catCount = {}
  for (let i = 0; i < weekScans.length; i++) {
    const cid = String(weekScans[i].get("category") || "")
    if (cid) catCount[cid] = (catCount[cid] || 0) + 1
  }
  let cats = []
  try {
    cats = e.app.findRecordsByFilter("waste_categories", "id != ''", "name", 0, 0) || []
  } catch (err) {
    cats = []
  }
  const catName = {}
  const catIcon = {}
  for (let i = 0; i < cats.length; i++) {
    catName[cats[i].id] = cats[i].get("name") || "?"
    catIcon[cats[i].id] = cats[i].get("icon") || ""
  }
  let weekTotal = 0
  const categories = Object.keys(catCount).map(function (cid) {
    weekTotal += catCount[cid]
    return { name: catName[cid] || "?", icon: catIcon[cid] || "", count: catCount[cid], percentage: 0 }
  })
  categories.sort(function (a, b) {
    return b.count - a.count
  })
  for (let i = 0; i < categories.length; i++) {
    categories[i].percentage =
      weekTotal > 0 ? Math.round((categories[i].count / weekTotal) * 1000) / 10 : 0
  }

  // ── antrian verifikasi (submitted = menunggu keputusan) ──
  const verifPending = e.app.countRecords("user_missions", $dbx.hashExp({ status: "submitted" }))

  // ── cache stats (ditulis hook scan sprint 11) ──
  let hit = 0
  let miss = 0
  try {
    const row = e.app.findFirstRecordByFilter("app_settings", "key = {:k}", { k: "scan_cache_stats" })
    const v = jsonValue(row.get("value")) || {}
    hit = v.hit || 0
    miss = v.miss || 0
  } catch (err) {
    /* belum ada aktivitas scan */
  }
  const totalHits = hit + miss
  const hitRate = totalHits > 0 ? Math.round((hit / totalHits) * 1000) / 10 : null

  // ── LLM bulan berjalan (llm_meta.tokens; baris cache tidak dihitung ganda) ──
  let tokensMonth = 0
  for (let i = 0; i < monthScans.length; i++) {
    const meta = jsonValue(monthScans[i].get("llm_meta"))
    if (!meta || meta.cached === true) continue
    const tokens = meta.tokens && meta.tokens.total_tokens
    if (typeof tokens === "number" && isFinite(tokens)) tokensMonth += tokens
  }
  const rawCost = parseFloat($os.getenv("LLM_COST_PER_1K_TOKENS") || "0")
  const costPer1k = !isNaN(rawCost) && rawCost > 0 ? rawCost : 0
  const budgetRaw = parseFloat($os.getenv("LLM_BUDGET_MONTHLY") || "")
  const budget = !isNaN(budgetRaw) && budgetRaw > 0 ? budgetRaw : null

  return e.json(200, {
    users: { total: usersTotal, new_7d: usersNew7d },
    scans: { today: scansToday, total: scansTotal },
    verification: { pending: verifPending },
    cache: { hit: hit, miss: miss, hit_rate: hitRate },
    llm: {
      tokens_month: tokensMonth,
      cost_month: Math.round((tokensMonth / 1000) * costPer1k * 100) / 100,
      budget_monthly: budget,
    },
    charts: {
      daily: daily,
      categories: categories,
    },
  })
}, $apis.requireAuth("users"))

// ═══════════ 2. Cron cleanup app_settings kedaluwarsa + llm_cache ═══════════
// Tubuh cron & route trigger memakai blok yang sama — diduplikasi (JSVM tidak
// meneruskan closure top-level ke handler).

cronAdd("ekoteologi_cleanup", $os.getenv("CLEANUP_CRON") || "30 3 * * *", () => {
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
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
  function sentryReport(scope, err) {
    // best-effort — kegagalan pelaporan tidak pernah mematikan cron
    try {
      const dsn = ($os.getenv("SENTRY_DSN") || "").trim()
      const m = dsn.match(/^(https?):\/\/([^@]+)@([^/]+)\/(\d+)\/?$/)
      if (!m) return
      $http.send({
        url: m[1] + "://" + m[3] + "/api/" + m[4] + "/store/",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth":
            "Sentry sentry_version=7, sentry_key=" + m[2] + ", sentry_client=ekoteologi-pb/0.1",
        },
        body: JSON.stringify({
          message: String(err),
          level: "error",
          platform: "javascript",
          logger: scope,
          environment: $os.getenv("EKO_APP_ENV") || "development",
          timestamp: Math.floor(Date.now() / 1000),
        }),
        timeout: 10,
      })
    } catch (err2) {}
  }
  try {
    const today = isoDay(new Date())
    const nowMs = Date.now()
    let settingsRemoved = 0
    let cacheRemoved = 0
    const rows = $app.findRecordsByFilter("app_settings", "id != ''", "", 0, 0) || []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const key = String(r.get("key") || "")
      let stale = false
      if (
        key.indexOf("sr:") === 0 ||
        key.indexOf("scan_quota:") === 0 ||
        key.indexOf("sd:") === 0
      ) {
        const datePart = key.slice(-10) // YYYY-MM-DD di akhir kunci
        if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < today) stale = true
      } else if (key.indexOf("login_guard:") === 0) {
        const v = jsonValue(r.get("value"))
        // jendela guard 15 menit (guard sprint 10); baris korup ikut dibuang
        if (!v || !v.start || nowMs - v.start > 15 * 60 * 1000) stale = true
      } else if (key.indexOf("fcm:tk:") === 0) {
        const v = jsonValue(r.get("value"))
        if (v && v.expires_at && v.expires_at < nowMs) stale = true
      }
      if (stale) {
        try {
          $app.delete(r)
          settingsRemoved++
        } catch (err) {}
      }
    }
    let cacheRows = []
    try {
      cacheRows =
        $app.findRecordsByFilter("llm_cache", "expires != '' && expires < {:n}", "", 0, 0, {
          n: new Date().toISOString(),
        }) || []
    } catch (err) {
      cacheRows = []
    }
    for (let i = 0; i < cacheRows.length; i++) {
      try {
        $app.delete(cacheRows[i])
        cacheRemoved++
      } catch (err) {}
    }
    console.log(
      "CRON ekoteologi_cleanup: settings=" + settingsRemoved + " cache=" + cacheRemoved
    )
  } catch (err) {
    console.log("CRON ekoteologi_cleanup gagal: " + err)
    sentryReport("cron.cleanup", err)
  }
})

routerAdd("POST", "/api/ekoteologi/cron/cleanup", (e) => {
  const auth = e.auth
  if (!auth || auth.collection().name !== "users" || auth.get("role") !== "admin") {
    throw new UnauthorizedError("Hanya admin yang dapat memicu pembersihan.")
  }
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
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
  const today = isoDay(new Date())
  const nowMs = Date.now()
  let settingsRemoved = 0
  let cacheRemoved = 0
  const rows = e.app.findRecordsByFilter("app_settings", "id != ''", "", 0, 0) || []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const key = String(r.get("key") || "")
    let stale = false
    if (key.indexOf("sr:") === 0 || key.indexOf("scan_quota:") === 0 || key.indexOf("sd:") === 0) {
      const datePart = key.slice(-10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < today) stale = true
    } else if (key.indexOf("login_guard:") === 0) {
      const v = jsonValue(r.get("value"))
      if (!v || !v.start || nowMs - v.start > 15 * 60 * 1000) stale = true
    } else if (key.indexOf("fcm:tk:") === 0) {
      const v = jsonValue(r.get("value"))
      if (v && v.expires_at && v.expires_at < nowMs) stale = true
    }
    if (stale) {
      try {
        e.app.delete(r)
        settingsRemoved++
      } catch (err) {}
    }
  }
  let cacheRows = []
  try {
    cacheRows =
      e.app.findRecordsByFilter("llm_cache", "expires != '' && expires < {:n}", "", 0, 0, {
        n: new Date().toISOString(),
      }) || []
  } catch (err) {
    cacheRows = []
  }
  for (let i = 0; i < cacheRows.length; i++) {
    try {
      e.app.delete(cacheRows[i])
      cacheRemoved++
    } catch (err) {}
  }
  return e.json(200, { settings_removed: settingsRemoved, cache_removed: cacheRemoved })
}, $apis.requireAuth("users"))

// ═══════════ 3. Backup manual (on demand — role admin) ═══════════
// Jadwal otomatis = fitur bawaan PB via migrasi sprint 13 (settings.backups).

routerAdd("POST", "/api/ekoteologi/cron/backup", (e) => {
  const auth = e.auth
  if (!auth || auth.collection().name !== "users" || auth.get("role") !== "admin") {
    throw new UnauthorizedError("Hanya admin yang dapat membuat cadangan.")
  }
  const d = new Date()
  function p2(n) {
    return n < 10 ? "0" + n : "" + n
  }
  const name =
    "manual_" +
    d.getFullYear() +
    p2(d.getMonth() + 1) +
    p2(d.getDate()) +
    "-" +
    p2(d.getHours()) +
    p2(d.getMinutes()) +
    p2(d.getSeconds()) +
    ".zip"
  $app.createBackup(new Context(), name)
  console.log("BACKUP manual oleh " + auth.id + " -> " + name)
  return e.json(200, { file: name })
}, $apis.requireAuth("users"))

// ═══════════════════ 4. Error hook → Sentry / PB logs ═══════════════════
// Error bisnis (ApiError 4xx) TIDAK dilaporkan; tanpa SENTRY_DSN hanya PB
// logs. Reporter diduplikasi di cron cleanup di atas (tak melewati router).

routerUse((e) => {
  function sentryReport(path, err) {
    try {
      const dsn = ($os.getenv("SENTRY_DSN") || "").trim()
      const m = dsn.match(/^(https?):\/\/([^@]+)@([^/]+)\/(\d+)\/?$/)
      if (!m) return
      $http.send({
        url: m[1] + "://" + m[3] + "/api/" + m[4] + "/store/",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth":
            "Sentry sentry_version=7, sentry_key=" + m[2] + ", sentry_client=ekoteologi-pb/0.1",
        },
        body: JSON.stringify({
          message: String(err),
          level: "error",
          platform: "javascript",
          logger: "route",
          environment: $os.getenv("EKO_APP_ENV") || "development",
          extra: { path: path },
          timestamp: Math.floor(Date.now() / 1000),
        }),
        timeout: 10,
      })
    } catch (err2) {}
  }
  try {
    return e.next()
  } catch (err) {
    let path = ""
    try {
      path = e.request.url.path
    } catch (errP) {}
    const status = err && typeof err.status === "number" ? err.status : 0
    if (status < 400 || status >= 500) {
      console.log("ROUTE ERROR " + path + ": " + err)
      sentryReport(path, err)
    }
    throw err
  }
})
