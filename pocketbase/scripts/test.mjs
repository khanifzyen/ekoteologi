#!/usr/bin/env node
/**
 * Sprint 9 — verifikasi fondasi PocketBase (pengganti pytest api).
 * Sprint 10 — +rate limit settings, audit log, guard login, autodate.
 * Sprint 11 — +route scan AI (mock), cache llm_cache + hit rate, kuota harian,
 *             ledger append-only + sinkron users.points.
 *
 * Boot instance uji sekali pakai (pb_data sementara), lalu asersi via HTTP:
 *   1. /api/health + route kustom /api/ekoteologi/ping
 *   2. Migrasi skema: seluruh koleksi ter-port ada; `users` auth collection
 *   3. Seed awal: 7 kategori sampah, 10 levels, 10 badges
 *   4. API rules: default deny, ownership, role admin/verifier, anti dobel klaim
 *   5. Rate limit settings (sprint 10)
 *   6. Audit log (sprint 10)
 *   7. Guard login per-identitas (sprint 10)
 *   8. Autodate & OAuth2 (sprint 10)
 *   9. Scan AI: auth/validasi foto, mock LLM tervalidasi, cache + hit rate,
 *      duplikat, kuota harian 429, ledger + sinkron poin, audit (sprint 11)
 *
 * Jalankan: make pb-test   (butuh binary ./pocketbase — `make pb-install`)
 */
import { spawn, spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import os from "node:os"
import net from "node:net"

const DIR = path.dirname(fileURLToPath(import.meta.url))
const PB_DIR = path.resolve(DIR, "..")
const PB_BIN = process.env.PB_BIN || path.join(PB_DIR, "pocketbase")
const MIGRATIONS = path.join(PB_DIR, "pb_migrations")
const HOOKS = path.join(PB_DIR, "pb_hooks")
const PORT = Number(process.env.PB_TEST_PORT || 18090 + (process.pid % 400))
let BASE = `http://127.0.0.1:${PORT}`
const SUPERUSER_EMAIL = "admin@ekoteologi.id"
const SUPERUSER_PASSWORD = "ekoteologi123"

let passed = 0
let failed = 0
function check(name, cond, detail = "") {
  if (cond) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

async function api(method, urlPath, { token, body, raw } = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (raw) return { status: res.status, res }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { status: res.status, data }
}

const auth = async (collection, identity, password) => {
  const { status, data } = await api("POST", `/api/collections/${collection}/auth-with-password`, {
    body: { identity, password },
  })
  if (status !== 200) throw new Error(`auth ${collection} gagal (${status})`)
  return data.token
}

// Port bebas — hindari bentrok dgn instance sisa run lain (sumber flake).
async function freePort(preferred) {
  for (let p = preferred; p < preferred + 50; p++) {
    const free = await new Promise((resolve) => {
      const srv = net.createServer()
      srv.once("error", () => resolve(false))
      srv.once("listening", () => srv.close(() => resolve(true)))
      srv.listen(p, "127.0.0.1")
    })
    if (free) return p
  }
  throw new Error("tidak ada port bebas")
}

const tmpData = path.join(os.tmpdir(), `pb-test-${process.pid}-${Date.now()}`)
let server = null

async function startServer() {
  rmSync(tmpData, { recursive: true, force: true })
  const port = await freePort(PORT)
  BASE = `http://127.0.0.1:${port}`

  // Inisialisasi superuser via env (pola yang sama dgn Makefile/compose):
  // CLI upsert sebelum serve — PB v0.40 tidak lagi membuat superuser dari
  // env PB_SUPERUSER_* otomatis saat serve.
  const up = spawnSync(
    PB_BIN,
    ["superuser", "upsert", SUPERUSER_EMAIL, SUPERUSER_PASSWORD, "--dir", tmpData],
    { stdio: "inherit" }
  )
  if (up.status !== 0) throw new Error("superuser upsert gagal")

  server = spawn(
    PB_BIN,
    [
      "serve",
      "--dir",
      tmpData,
      "--migrationsDir",
      MIGRATIONS,
      "--hooksDir",
      HOOKS,
      "--http",
      `127.0.0.1:${port}`,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      // Kuota harian kecil agar uji 429 murah (env hanya utk instance uji).
      env: { ...process.env, SCAN_DAILY_LIMIT: "3", LLM_MODE: "mock" },
    }
  )
  server.stdout.on("data", (d) => process.env.PB_TEST_VERBOSE && process.stdout.write(d))
  server.stderr.on("data", (d) => process.stderr.write(d))

  for (let i = 0; i < 60; i++) {
    try {
      const { status } = await api("GET", "/api/health")
      if (status === 200) return
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error("instance uji tidak kunjung siap")
}

function stopServer() {
  if (server) server.kill("SIGTERM")
  rmSync(tmpData, { recursive: true, force: true })
}

const EXPECTED_COLLECTIONS = [
  "users", "fcm_tokens", "levels", "point_transactions", "badges", "user_badges",
  "waste_categories", "scans", "missions", "user_missions", "modules", "lessons",
  "quizzes", "quiz_questions", "user_module_progress", "user_quiz_attempts",
  "daily_contents", "posts", "post_likes", "post_comments", "reports",
  "map_locations", "rewards", "redemptions", "notifications", "audit_logs",
  "analytics_events", "app_settings", "llm_cache",
]

async function main() {
  await startServer()
  try {
    // ── 1. smoke endpoint ──
    console.log("[1] Smoke endpoint")
    {
      const { status, data } = await api("GET", "/api/health")
      check("GET /api/health → 200", status === 200 && data?.code === 200)
    }
    {
      const { status, data } = await api("GET", "/api/ekoteologi/ping")
      check("GET /api/ekoteologi/ping (route hook) → 200", status === 200 && !!data?.name && !!data?.version)
    }

    // ── 2. skema ter-port ──
    console.log("[2] Port skema (koleksi & relasi)")
    let suToken
    {
      suToken = await auth("_superusers", SUPERUSER_EMAIL, SUPERUSER_PASSWORD)
      const { status, data } = await api("GET", "/api/collections?perPage=200", { token: suToken })
      check("superuser bisa list koleksi", status === 200)
      const names = new Set((data?.items || []).map((c) => c.name))
      const missing = EXPECTED_COLLECTIONS.filter((n) => !names.has(n))
      check(`seluruh ${EXPECTED_COLLECTIONS.length} koleksi ada`, missing.length === 0, `kurang: ${missing.join(", ")}`)
      const users = (data?.items || []).find((c) => c.name === "users")
      check("users = auth collection", users?.type === "auth")
      const userFields = new Set((users?.fields || []).map((f) => f.name))
      const needUserFields = ["full_name", "phone", "avatar", "role", "points", "city", "current_streak", "longest_streak", "last_active_date", "is_active"]
      const missF = needUserFields.filter((f) => !userFields.has(f))
      check("field users lengkap", missF.length === 0, `kurang: ${missF.join(", ")}`)
      const um = (data?.items || []).find((c) => c.name === "user_missions")
      const idx = (um?.indexes || []).join(" ")
      check("anti dobel klaim: unique index (user, mission, period_date)", /UNIQUE INDEX ux_user_missions_claim/.test(idx))
      const umFields = new Set((um?.fields || []).map((f) => f.name))
      check("user_missions punya consent_at (PRD §9)", umFields.has("consent_at"))
    }

    // ── 3. seed ──
    console.log("[3] Seed data awal")
    {
      const cats = await api("GET", "/api/collections/waste_categories/records?perPage=50")
      check("7 kategori sampah publik terbaca", cats.status === 200 && cats.data?.totalItems === 7)
      const levels = await api("GET", "/api/collections/levels/records?perPage=50&sort=level")
      check("10 levels (ladder 1..10)", levels.status === 200 && levels.data?.totalItems === 10 && levels.data.items[0].level === 1 && levels.data.items[9].level === 10)
      const badges = await api("GET", "/api/collections/badges/records?perPage=50")
      check("10 badges", badges.status === 200 && badges.data?.totalItems === 10)
      check("levels publik terbaca tanpa token", levels.status === 200)
    }

    // ── 4. rules: default deny, ownership, role, anti dobel ──
    console.log("[4] API rules")
    let adminToken, aToken, bToken, aId, bId, missionId = ""
    {
      // default deny: koleksi terkunci menolak anonim
      const locked = await api("POST", "/api/collections/point_transactions/records", { body: { user: "x", amount: 1, source: "scan" } })
      check("default deny: point_transactions create anonim ditolak", locked.status >= 400)
      const set = await api("GET", "/api/collections/app_settings/records")
      check("default deny: app_settings list anonim ditolak", set.status >= 400)

      // registrasi publik: role wajib "user"
      const badRole = await api("POST", "/api/collections/users/records", {
        body: { email: "hacker@ekoteologi.id", password: "RahasiaKu123", passwordConfirm: "RahasiaKu123", full_name: "Hacker", role: "admin" },
      })
      check("registrasi dengan role=admin ditolak", badRole.status >= 400)
      const okA = await api("POST", "/api/collections/users/records", {
        body: { email: "a@ekoteologi.id", password: "RahasiaKu123", passwordConfirm: "RahasiaKu123", full_name: "Pengguna A" },
      })
      const okB = await api("POST", "/api/collections/users/records", {
        body: { email: "b@ekoteologi.id", password: "RahasiaKu123", passwordConfirm: "RahasiaKu123", full_name: "Pengguna B" },
      })
      check("registrasi publik role default user berhasil", okA.status === 200 && okB.status === 200, JSON.stringify(okA.data))
      aId = okA.data?.id
      bId = okB.data?.id
      check("role default = user", okA.data?.role === "user" && okB.data?.role === "user")
      const okNoRole = await api("POST", "/api/collections/users/records", {
        body: { email: "tanpa-role@ekoteologi.id", password: "RahasiaKu123", passwordConfirm: "RahasiaKu123", full_name: "Tanpa Role" },
      })
      check("registrasi tanpa kirim role → default user (hook)", okNoRole.status === 200 && okNoRole.data?.role === "user")
      aToken = await auth("users", "a@ekoteologi.id", "RahasiaKu123")
      bToken = await auth("users", "b@ekoteologi.id", "RahasiaKu123")

      // ownership scans (tulis terkunci sejak sprint 11 — hanya route hook)
      const anonScan = await api("POST", "/api/collections/scans/records", { body: { user: aId, item_name: "botol" } })
      check("anonim tidak bisa create scans", anonScan.status >= 400)
      const ownScan = await api("POST", "/api/collections/scans/records", { token: aToken, body: { user: aId, item_name: "botol plastik", points: 99 } })
      check("user TIDAK bisa create scans langsung (tulis via route hook — sprint 11)", ownScan.status >= 400, `status ${ownScan.status}`)
      const foreign = await api("POST", "/api/collections/scans/records", { token: aToken, body: { user: bId, item_name: "bukan milikmu" } })
      check("create scans atas nama user lain ditolak", foreign.status >= 400)
      const listA = await api("GET", "/api/collections/scans/records", { token: aToken })
      const listB = await api("GET", "/api/collections/scans/records", { token: bToken })
      check("list scans kosong sebelum scan via route", listA.data?.totalItems === 0 && listB.data?.totalItems === 0)

      // anti-eskalasi via PATCH profil (guard hook)
      const escal = await api("PATCH", `/api/collections/users/records/${aId}`, { token: aToken, body: { role: "admin", points: 9999 } })
      check("user tak bisa menaikkan role/points sendiri (hook guard)", escal.status >= 400)
      const rename = await api("PATCH", `/api/collections/users/records/${aId}`, { token: aToken, body: { full_name: "Pengguna A Baru", city: "Bandung" } })
      check("user tetap bisa mengubah profil sendiri", rename.status === 200 && rename.data?.city === "Bandung")

      // admin penuh + level akses verifier
      await api("PATCH", `/api/collections/users/records/${bId}`, { token: suToken, body: { role: "verifier" } })
      const mission = await api("POST", "/api/collections/missions/records", {
        token: suToken,
        body: { title: "Misi Uji", points: 10, verification: "manual", is_active: true },
      })
      check("superuser buat misi", mission.status === 200)
      missionId = mission.data?.id
      const anonMissions = await api("GET", "/api/collections/missions/records")
      check("misi aktif terbaca publik", anonMissions.status === 200 && anonMissions.data?.totalItems === 1)

      // klaim misi via route hook (sprint 12): manual = auto-approve + poin
      const manualClaim = await api("POST", `/api/ekoteologi/missions/${missionId}/claim`, {
        token: aToken,
        body: {},
      })
      check(
        "klaim manual via route → auto-approve",
        manualClaim.status === 200 && manualClaim.data?.claim?.status === "approved",
        JSON.stringify(manualClaim.data)
      )
      check(
        "klaim manual: poin misi langsung masuk (+10)",
        manualClaim.data?.claim?.points_awarded === 10 && /10 poin/.test(manualClaim.data?.message || ""),
        JSON.stringify(manualClaim.data)
      )
      const dupRoute = await api("POST", `/api/ekoteologi/missions/${missionId}/claim`, {
        token: aToken,
        body: {},
      })
      check("anti dobel klaim (route) → 409 ramah", dupRoute.status === 409 && /(klaim|selesai)/i.test(dupRoute.data?.message || ""), JSON.stringify(dupRoute.data))
      const directClaim = await api("POST", "/api/collections/user_missions/records", {
        token: aToken,
        body: { user: aId, mission: missionId },
      })
      check("create user_missions via API koleksi ditolak (klaim hanya via route — sprint 12)", directClaim.status >= 400, `status ${directClaim.status}`)
      const aAfterClaim = await api("GET", `/api/collections/users/records/${aId}`, { token: aToken })
      check("users.points tersinkron dgn ledger klaim manual (10)", aAfterClaim.data?.points === 10, `points=${aAfterClaim.data?.points}`)
      check("level engine: 10 poin → level 1 Pemula", aAfterClaim.data?.level === 1 && aAfterClaim.data?.level_title === "Pemula", JSON.stringify({ level: aAfterClaim.data?.level, title: aAfterClaim.data?.level_title }))
      const notifClaim = await api("GET", "/api/collections/notifications/records", { token: aToken })
      check("notifikasi 'Poin misi masuk' utk user", (notifClaim.data?.items || []).some((n) => n.title === "Poin misi masuk"), JSON.stringify(notifClaim.data?.items?.map((n) => n.title)))

      // ledger ditulis sistem; user hanya baca miliknya
      const ledger = await api("POST", "/api/collections/point_transactions/records", {
        token: suToken,
        body: { user: aId, amount: 10, source: "adjustment", note: "penyesuaian uji" },
      })
      check("ledger ditulis konteks sistem", ledger.status === 200)
      const ledgerA = await api("GET", "/api/collections/point_transactions/records", { token: aToken })
      const ledgerB = await api("GET", "/api/collections/point_transactions/records", { token: bToken })
      check("ledger: A lihat miliknya (2 baris), B tidak", ledgerA.data?.totalItems === 2 && ledgerB.data?.totalItems === 0, `A=${ledgerA.data?.totalItems} B=${ledgerB.data?.totalItems}`)
      const ledgerWrite = await api("POST", "/api/collections/point_transactions/records", { token: aToken, body: { user: aId, amount: 100, source: "scan" } })
      check("user tidak bisa menulis ledger sendiri (append-only)", ledgerWrite.status >= 400)

      // notifikasi: milik + broadcast terlihat; create terkunci
      const bc = await api("POST", "/api/collections/notifications/records", {
        token: suToken,
        body: { title: "Broadcast uji", body: "halo semua", type: "info" },
      })
      check("superuser buat broadcast (user kosong)", bc.status === 200)
      const notifA = await api("GET", "/api/collections/notifications/records", { token: aToken })
      check("user melihat notifikasi miliknya + broadcast", notifA.status === 200 && (notifA.data?.items || []).some((n) => n.title === "Broadcast uji") && (notifA.data?.items || []).some((n) => n.title === "Poin misi masuk"), JSON.stringify(notifA.data?.items?.map((n) => n.title)))
      const notifWrite = await api("POST", "/api/collections/notifications/records", { token: aToken, body: { title: "spam" } })
      check("user tidak bisa create notifications", notifWrite.status >= 400)

      // konten terbit vs draf
      await api("POST", "/api/collections/modules/records", {
        token: suToken,
        body: { title: "Modul Draf", slug: "modul-draf", is_published: false },
      })
      const pubModules = await api("GET", "/api/collections/modules/records")
      check("modul draf tidak terlihat publik", pubModules.status === 200 && pubModules.data?.totalItems === 0)
      const suModules = await api("GET", "/api/collections/modules/records", { token: suToken })
      check("modul draf terlihat oleh superuser", suModules.data?.totalItems === 1)

      // superuser boleh mengatur role (jalur admin panel)
      const promote = await api("PATCH", `/api/collections/users/records/${bId}`, { token: suToken, body: { role: "admin" } })
      check("superuser mengatur role admin", promote.status === 200 && promote.data?.role === "admin")
      adminToken = await auth("users", "b@ekoteologi.id", "RahasiaKu123")
      const auditList = await api("GET", "/api/collections/audit_logs/records", { token: adminToken })
      check("admin (role) membaca audit_logs", auditList.status === 200)
      const auditA = await api("GET", "/api/collections/audit_logs/records", { token: aToken })
      check("user biasa ditolak baca audit_logs", auditA.status >= 400 || auditA.data?.totalItems === 0)
    }

    // ── 5. settings bootstrap: rate limit (sprint 10) ──
    console.log("[5] Rate limit settings (pengganti middleware Redis)")
    {
      const { status, data } = await api("GET", "/api/settings", { token: suToken })
      check("superuser membaca settings", status === 200)
      check("rate limiter aktif", data?.rateLimits?.enabled === true)
      const rules = data?.rateLimits?.rules || []
      const find = (label) => rules.find((r) => r.label === label)
      const login = find("users:authWithPassword")
      check("rule users:authWithPassword 30/900 dtk/IP", !!login && login.maxRequests === 30 && login.duration === 900, JSON.stringify(login))
      const refresh = find("users:authRefresh")
      check("rule users:authRefresh 60/mnt/IP", !!refresh && refresh.maxRequests === 60 && refresh.duration === 60)
      const create = find("users:create")
      check("rule users:create 20/jam/IP", !!create && create.maxRequests === 20 && create.duration === 3600)
      check("pelindung global /api/ ada", !!find("/api/"))
    }

    // ── 6. audit log (sprint 10) ──
    console.log("[6] Audit log (pengganti middleware audit)")
    {
      const list = await api("GET", "/api/collections/audit_logs/records?perPage=50", { token: adminToken })
      check("audit_logs terisi dari aksi §4", list.status === 200 && list.data?.totalItems > 0)
      const items = list.data?.items || []
      const regCreate = items.find((r) => r.action === "create" && r.entity === "users" && r.entity_id === aId)
      check("audit create registrasi user A", !!regCreate, JSON.stringify(items.find((r) => r.action === "create" && r.entity === "users")))
      check("diff create memuat full_name & bebas password", !!regCreate && regCreate.diff?.full_name?.new === "Pengguna A" && !("password" in (regCreate.diff || {})) && !("tokenKey" in (regCreate.diff || {})))
      const loginAudit = items.find((r) => r.action === "login" && r.entity_id === aId)
      check("audit login user A", !!loginAudit)
      // scans tak bisa dibuat user via API lagi (sprint 11) — cakupan audit
      // koleksi bisnis dicek lewat klaim misi via route milik A (§4).
      const claimAudit = items.find((r) => r.action === "mission_claim" && r.actor === aId)
      check("audit klaim misi via route (mission_claim, mode manual)", !!claimAudit && claimAudit.diff?.mode === "manual", JSON.stringify(items.find((r) => r.action === "mission_claim")))
      const renameAudit = items.find((r) => r.action === "update" && r.entity === "users" && r.entity_id === aId)
      check("audit update profil memuat diff kota", !!renameAudit && renameAudit.diff?.city?.new === "Bandung")
      const hackerAudit = items.find((r) => r.action === "create" && r.entity === "users" && r.diff?.full_name?.new === "Hacker")
      check("create yang DITOLAK rule tidak ter-audit", !hackerAudit)
    }

    // ── 7. guard login per-identitas (sprint 10) ──
    console.log("[7] Guard login per-identitas (10 percobaan / 15 menit)")
    {
      const okC = await api("POST", "/api/collections/users/records", {
        body: { email: "c@ekoteologi.id", password: "RahasiaKu123", passwordConfirm: "RahasiaKu123", full_name: "Pengguna C" },
      })
      check("registrasi user C", okC.status === 200)
      let last = null
      for (let i = 0; i < 5; i++) {
        last = await api("POST", "/api/collections/users/auth-with-password", { body: { identity: "c@ekoteologi.id", password: "SalahBes123" } })
      }
      check("5 gagal sandi → tetap 400 (belum dikunci)", last.status === 400, `status ${last.status}`)
      const okLogin = await api("POST", "/api/collections/users/auth-with-password", { body: { identity: "c@ekoteologi.id", password: "RahasiaKu123" } })
      check("login sukses masih diizinkan", okLogin.status === 200)
      let blocked = null
      for (let i = 0; i < 10; i++) {
        blocked = await api("POST", "/api/collections/users/auth-with-password", { body: { identity: "c@ekoteologi.id", password: "SalahBes123" } })
      }
      check("percobaan ke-10 setelah reset masih 400", blocked.status === 400, `status ${blocked.status}`)
      blocked = await api("POST", "/api/collections/users/auth-with-password", { body: { identity: "c@ekoteologi.id", password: "SalahBes123" } })
      check("percobaan ke-11 dikunci → 429", blocked.status === 429, `status ${blocked.status} ${JSON.stringify(blocked.data)}`)
      check("pesan 429 berbahasa Indonesia ramah", typeof blocked.data?.message === "string" && blocked.data.message.includes("percobaan masuk"))
      const failed = await api("GET", "/api/collections/audit_logs/records?filter=" + encodeURIComponent("action = 'login_failed' && entity_id = 'c@ekoteologi.id'"), { token: adminToken })
      check("percobaan diblokir ter-audit (login_failed rate_limited)", failed.status === 200 && failed.data?.totalItems > 0 && failed.data.items[0].diff?.reason === "rate_limited")
      // identitas lain tidak ikut terkunci (guard per-identitas, bukan global)
      const other = await api("POST", "/api/collections/users/auth-with-password", { body: { identity: "a@ekoteologi.id", password: "RahasiaKu123" } })
      check("identitas lain tidak terbawa blokir", other.status === 200)
    }

    // ── 8. autodate & oauth2 (sprint 10) ──
    console.log("[8] Autodate koleksi & status OAuth2")
    {
      // scans ditulis via route hook (§9); di sini superuser membuat contoh
      // utk asersi autodate (superuser lewati rule terkunci).
      const seedScan = await api("POST", "/api/collections/scans/records", {
        token: suToken,
        body: { user: aId, item_name: "contoh autodate" },
      })
      check("autodate: record punya created/updated", seedScan.status === 200 && !!seedScan.data?.created && !!seedScan.data?.updated, JSON.stringify({ created: seedScan.data?.created }))
      const usersCol = await api("GET", "/api/collections/users", { token: suToken })
      check("tanpa env GOOGLE_*: oauth2 users nonaktif", usersCol.status === 200 && usersCol.data?.oauth2?.enabled === false)
    }

    // ── 9. scan AI via route kustom (sprint 11) ──
    console.log("[9] Scan AI: foto → LLM mock → JSON tervalidasi → tersimpan + poin")
    let photo1Points = 0
    {
      // PNG 1x1 valid sebagai "foto" uji (magic bytes diperiksa hook).
      const PNG_1PX = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64"
      )
      // Varian byte berbeda → digest berbeda (PNG 1x1 warna merah).
      const PNG_RED = Buffer.concat([
        PNG_1PX.subarray(0, PNG_1PX.length - 1),
        Buffer.from([PNG_1PX[PNG_1PX.length - 1] ^ 0x01]),
      ])

      const scanPost = (token, buffer, filename) => {
        const form = new FormData()
        form.append("image", new Blob([buffer], { type: "image/png" }), filename)
        return fetch(`${BASE}/api/ekoteologi/scan`, {
          method: "POST",
          headers: token ? { Authorization: token } : {},
          body: form,
        }).then(async (res) => ({
          status: res.status,
          headers: res.headers,
          data: await res.json().catch(() => null),
        }))
      }

      // auth & validasi
      const anon = await scanPost("", PNG_1PX, "foto.png")
      check("scan tanpa token → 401", anon.status === 401, `status ${anon.status}`)
      const noFile = await fetch(`${BASE}/api/ekoteologi/scan`, {
        method: "POST",
        headers: { Authorization: aToken },
      })
      check("scan tanpa foto → 400", noFile.status === 400, `status ${noFile.status}`)
      const badType = await scanPost(aToken, Buffer.from("bukan gambar"), "foto.txt")
      check("scan format bukan JPG/PNG/WebP → 400", badType.status === 400, `status ${badType.status}`)

      // mock LLM → kontrak respons + tersimpan + poin
      const first = await scanPost(aToken, PNG_1PX, "foto1.png")
      check("scan valid → 200", first.status === 200, JSON.stringify(first.data))
      photo1Points = first.data?.points ?? 0
      check(
        "kontrak respons lengkap (item_name, category, advice, quote, points, points_total, cached, duplicate)",
        !!first.data?.id &&
          typeof first.data?.item_name === "string" &&
          first.data?.item_name.length >= 2 &&
          !!first.data?.category?.id &&
          !!first.data?.category?.name &&
          typeof first.data?.advice === "string" &&
          first.data?.advice.length >= 5 &&
          typeof first.data?.quote?.text === "string" &&
          typeof first.data?.quote?.source === "string" &&
          typeof photo1Points === "number" &&
          photo1Points > 0 &&
          typeof first.data?.points_total === "number" &&
          first.data?.cached === false &&
          first.data?.duplicate === false,
        JSON.stringify(first.data)
      )
      const pointsTotalAfterFirst = first.data?.points_total ?? 0
      check("points_total = poin awal (klaim manual §4 + penyesuaian §4) + poin scan", pointsTotalAfterFirst === 20 + photo1Points, `${pointsTotalAfterFirst} vs ${20 + photo1Points}`)

      // poin via ledger + cache users.points tersinkron
      const aAfter = await api("GET", `/api/collections/users/records/${aId}`, { token: aToken })
      check("users.points tersinkron dgn ledger (cache poin)", aAfter.data?.points === 20 + photo1Points, `points=${aAfter.data?.points}`)
      const ledgerRows = await api(
        "GET",
        `/api/collections/point_transactions/records?filter=${encodeURIComponent(`user = "${aId}" && source = "scan"`)}`,
        { token: aToken }
      )
      const scanLedger = (ledgerRows.data?.items || []).find((r) => r.amount === photo1Points)
      check(
        "ledger append-only terisi (source=scan, amount, ref_id=scan)",
        ledgerRows.data?.totalItems >= 1 && !!scanLedger && scanLedger.ref_id === first.data?.id,
        JSON.stringify(ledgerRows.data?.items || [])
      )

      // record scans lengkap dgn llm_raw/llm_meta/quote (baca superuser)
      const scanRec = await api("GET", `/api/collections/scans/records/${first.data?.id}`, { token: suToken })
      check(
        "record scans memuat llm_raw + llm_meta + quote (PRD §5.3)",
        scanRec.status === 200 && !!scanRec.data?.llm_raw && !!scanRec.data?.llm_meta && !!scanRec.data?.quote?.text,
        JSON.stringify(scanRec.data?.llm_meta)
      )
      check(
        "llm_meta memuat provider/model/latency_ms/cached=false",
        scanRec.data?.llm_meta?.provider === "mock" &&
          scanRec.data?.llm_meta?.model === "mock" &&
          typeof scanRec.data?.llm_meta?.latency_ms === "number" &&
          scanRec.data?.llm_meta?.cached === false
      )
      check("field file image tersimpan", typeof scanRec.data?.image === "string" && scanRec.data.image.length > 0)

      // foto sama user sama → duplikat (poin 0) + cache hit
      const dup = await scanPost(aToken, PNG_1PX, "foto1.png")
      check("foto sama user sama → duplicate + points 0", dup.status === 200 && dup.data?.duplicate === true && dup.data?.points === 0, JSON.stringify(dup.data))
      check("duplikat tetap dilayani dari cache", dup.data?.cached === true)
      check("poin tidak bertambah utk duplikat", dup.data?.points_total === pointsTotalAfterFirst)

      // foto sama user lain → cache hit + tetap dapat poin
      const other = await scanPost(bToken, PNG_1PX, "foto1.png")
      check("foto sama user lain → cache hit", other.status === 200 && other.data?.cached === true, JSON.stringify(other.data))
      check("user lain tidak dianggap duplikat & dapat poin", other.data?.duplicate === false && other.data?.points > 0)
      const other2 = await scanPost(bToken, PNG_1PX, "foto1.png")
      check("user lain scan foto sama lagi → hit + duplikat", other2.status === 200 && other2.data?.cached === true && other2.data?.duplicate === true && other2.data?.points === 0, JSON.stringify(other2.data))

      // cache llm_cache berisi payload lengkap (baca superuser)
      const cacheRows = await api("GET", "/api/collections/llm_cache/records", { token: suToken })
      check("llm_cache terisi (kunci scan:*)", cacheRows.data?.totalItems >= 1, JSON.stringify(cacheRows.data?.totalItems))
      const cacheItem = (cacheRows.data?.items || [])[0]
      check(
        "entri llm_cache memuat hasil + expires",
        !!cacheItem && String(cacheItem.key).startsWith("scan:") && !!cacheItem.value?.item_name && !!cacheItem.expires
      )

      // statistik cache: 1 miss + 3 hit = 75% (target ≥70%)
      const stats = await api("GET", "/api/ekoteologi/scan/stats", { token: aToken })
      check("route stats: hit=3 miss=1", stats.data?.hit === 3 && stats.data?.miss === 1, JSON.stringify(stats.data))
      check("cache hit rate ≥70%", stats.data?.hit_rate >= 70, `hit_rate=${stats.data?.hit_rate}`)
      check("stats melaporkan mode LLM mock", stats.data?.llm_mode === "mock")

      // kuota harian (limit 3 di instance uji): A sudah 2× → scan ke-3 lolos, ke-4 → 429
      const quota1 = await api("GET", "/api/ekoteologi/scan/quota", { token: aToken })
      check("route kuota: used=2 limit=3", quota1.data?.used === 2 && quota1.data?.limit === 3 && quota1.data?.remaining === 1, JSON.stringify(quota1.data))
      const third = await scanPost(aToken, PNG_RED, "foto2.png")
      check("scan ketiga (foto lain) masih lolos", third.status === 200 && third.data?.duplicate === false, JSON.stringify(third.data))
      const over = await scanPost(aToken, PNG_RED, "foto2.png")
      check("scan melebihi kuota → 429", over.status === 429, `status ${over.status}`)
      check("429 membawa Retry-After header", !!over.headers.get("retry-after"), String(over.headers.get("retry-after")))
      check(
        "429 pesan Indonesia + retry_after di body",
        typeof over.data?.message === "string" && over.data.message.includes("Kuota scan harian habis") && typeof over.data?.retry_after === "number",
        JSON.stringify(over.data)
      )
      const quota2 = await api("GET", "/api/ekoteologi/scan/quota", { token: aToken })
      check("percobaan yang ditolak ikut terhitung (paritas Redis INCR)", quota2.data?.used === 4, JSON.stringify(quota2.data))

      // audit + metrik aktivasi
      const auditScan = await api(
        "GET",
        "/api/collections/audit_logs/records?filter=" + encodeURIComponent('action = "scan"'),
        { token: adminToken }
      )
      check("aksi scan ter-audit (action=scan)", auditScan.status === 200 && auditScan.data?.totalItems >= 4, `total=${auditScan.data?.totalItems}`)
      const events = await api(
        "GET",
        "/api/collections/analytics_events/records?filter=" + encodeURIComponent('name = "scan_pertama"'),
        { token: suToken }
      )
      // Scan §4 A dibuat lewat API koleksi (sebelum route ada) → hanya B yang
      // mencapai scan pertamanya via route.
      check("event scan_pertama tercatat utk scan pertama via route (B)", events.data?.totalItems === 1 && events.data?.items?.[0]?.user === bId, JSON.stringify(events.data?.items || []))

      // ledger append-only via API (hook model menolak)
      const ledgerId = scanLedger?.id
      const patchLedger = await api("PATCH", `/api/collections/point_transactions/records/${ledgerId}`, {
        token: suToken,
        body: { amount: 999 },
      })
      check("PATCH ledger ditolak (append-only)", patchLedger.status >= 400, `status ${patchLedger.status}`)
      const delLedger = await api("DELETE", `/api/collections/point_transactions/records/${ledgerId}`, { token: suToken })
      check("DELETE ledger ditolak (append-only)", delLedger.status >= 400, `status ${delLedger.status}`)
      const zeroLedger = await api("POST", "/api/collections/point_transactions/records", {
        token: suToken,
        body: { user: aId, amount: 0, source: "scan" },
      })
      check("ledger amount=0 ditolak", zeroLedger.status >= 400, `status ${zeroLedger.status}`)
      const negLedger = await api("POST", "/api/collections/point_transactions/records", {
        token: suToken,
        body: { user: aId, amount: -5, source: "scan" },
      })
      check("ledger amount negatif ditolak", negLedger.status >= 400, `status ${negLedger.status}`)
    }

    // ── 10. misi, verifikasi & gamifikasi (sprint 12) ──
    console.log("[10] Sprint 12: klaim 3 mode, verifikasi→ledger+notif, level, streak, badge, cron")
    {
      const pad = (n) => String(n).padStart(2, "0")
      const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const pbDay = (d) => `${isoDay(d)} 00:00:00.000Z`
      const today = pbDay(new Date())
      const dAgo = (n) => {
        const d = new Date()
        d.setDate(d.getDate() - n)
        return pbDay(d)
      }
      const monday = (() => {
        const d = new Date()
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
        return pbDay(d)
      })()

      const PNG_1PX = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64"
      )
      const PNG_RED = Buffer.concat([
        PNG_1PX.subarray(0, PNG_1PX.length - 1),
        Buffer.from([PNG_1PX[PNG_1PX.length - 1] ^ 0x01]),
      ])
      const scanPost = (token, buffer, filename) => {
        const form = new FormData()
        form.append("image", new Blob([buffer], { type: "image/png" }), filename)
        return fetch(`${BASE}/api/ekoteologi/scan`, {
          method: "POST",
          headers: token ? { Authorization: token } : {},
          body: form,
        }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => null) }))
      }
      const claimPost = (token, mission, fields, buffer) => {
        const form = new FormData()
        for (const [k, v] of Object.entries(fields || {})) form.append(k, v)
        if (buffer) form.append("proof", new Blob([buffer], { type: "image/png" }), "bukti.png")
        return fetch(`${BASE}/api/ekoteologi/missions/${mission}/claim`, {
          method: "POST",
          headers: token ? { Authorization: token } : {},
          body: form,
        }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => null) }))
      }

      // user E + misi uji
      const okE = await api("POST", "/api/collections/users/records", {
        body: { email: "dina@ekoteologi.id", password: "RahasiaKu123", passwordConfirm: "RahasiaKu123", full_name: "Dina Pemula" },
      })
      check("registrasi user E (protagonis sprint 12)", okE.status === 200)
      const eId = okE.data?.id
      const eToken = await auth("users", "dina@ekoteologi.id", "RahasiaKu123")
      const cats = await api("GET", "/api/collections/waste_categories/records?perPage=50")
      const catId = (name) => (cats.data?.items || []).find((c) => c.name === name)?.id
      const mkMission = async (body) => api("POST", "/api/collections/missions/records", { token: suToken, body })
      const photoM = await mkMission({ title: "Misi Foto Sprint12", points: 6, verification: "photo", type: "daily", is_active: true })
      const manual1 = await mkMission({ title: "Misi Manual Sprint12", points: 4, verification: "manual", type: "daily", is_active: true })
      const asAny = await mkMission({ title: "Misi Scan 2x Sprint12", points: 8, verification: "auto_scan", required_count: 2, type: "daily", is_active: true })
      const asLogam = await mkMission({ title: "Misi Scan Logam Sprint12", points: 5, verification: "auto_scan", required_count: 1, scan_category: catId("Logam"), type: "daily", is_active: true })
      const asFilter = await mkMission({ title: "Misi Scan B3 Sprint12", points: 10, verification: "auto_scan", required_count: 1, scan_category: catId("B3"), type: "daily", is_active: true })
      const weeklyM = await mkMission({ title: "Misi Mingguan Sprint12", points: 7, verification: "photo", type: "weekly", is_active: true })
      check("admin (role) buat misi uji", photoM.status === 200 && manual1.status === 200 && asAny.status === 200 && asLogam.status === 200 && asFilter.status === 200 && weeklyM.status === 200, JSON.stringify({ photoM: photoM.status, weekly: weeklyM.status }))

      // CRUD misi: user biasa ditolak (rules), nilai verification divalidasi skema
      const userCreate = await api("POST", "/api/collections/missions/records", { token: eToken, body: { title: "Misi Gelap", points: 99, verification: "manual" } })
      check("user biasa tidak bisa buat misi (createRule admin)", userCreate.status >= 400, `status ${userCreate.status}`)
      const badVerif = await api("POST", "/api/collections/missions/records", { token: suToken, body: { title: "Misi Aneh", points: 5, verification: "tebak" } })
      check("mode verifikasi di luar photo/auto_scan/manual ditolak", badVerif.status >= 400, `status ${badVerif.status}`)

      // ── klaim photo: validasi consent/foto → antrian ──
      const noConsent = await claimPost(eToken, photoM.data?.id, { consent: "0" }, PNG_1PX)
      check("klaim photo tanpa consent → 400", noConsent.status === 400, `status ${noConsent.status}`)
      const noFile = await claimPost(eToken, photoM.data?.id, { consent: "1" }, null)
      check("klaim photo tanpa bukti → 400", noFile.status === 400, `status ${noFile.status}`)
      const badImg = await claimPost(eToken, photoM.data?.id, { consent: "1" }, Buffer.from("bukan gambar"))
      check("klaim photo format bukan gambar → 400", badImg.status === 400, `status ${badImg.status}`)
      const claim1 = await claimPost(eToken, photoM.data?.id, { consent: "1", note: "ini buktinya" }, PNG_1PX)
      check("klaim photo valid → submitted + consent tercatat", claim1.status === 200 && claim1.data?.claim?.status === "submitted", JSON.stringify(claim1.data))
      const claim1Id = claim1.data?.claim?.id
      const claimRec = await api("GET", `/api/collections/user_missions/records/${claim1Id}`, { token: suToken })
      check("consent_at server-side + proof tersimpan", !!claimRec.data?.consent_at && typeof claimRec.data?.proof === "string" && claimRec.data.proof.length > 0, JSON.stringify({ consent_at: claimRec.data?.consent_at, proof: claimRec.data?.proof }))
      const dupPhoto = await claimPost(eToken, photoM.data?.id, { consent: "1" }, PNG_RED)
      check("anti dobel klaim photo → 409", dupPhoto.status === 409, JSON.stringify(dupPhoto.data))
      const ownerPatch = await api("PATCH", `/api/collections/user_missions/records/${claim1Id}`, { token: eToken, body: { status: "approved" } })
      check("pemilik klaim tidak bisa PATCH sendiri (rules staff; PB menyamarkan sbg 404)", ownerPatch.status === 403 || ownerPatch.status === 404, `status ${ownerPatch.status}`)
      const queue = await api("GET", "/api/collections/user_missions/records?filter=" + encodeURIComponent('status = "submitted"') + "&expand=user,mission", { token: adminToken })
      check("verifier/admin melihat antrian klaim photo", queue.status === 200 && (queue.data?.items || []).some((r) => r.id === claim1Id && r.expand?.mission?.title === "Misi Foto Sprint12"), JSON.stringify(queue.data?.totalItems))

      // ── verifikasi: reject (catatan wajib) → resubmit → approve ──
      const rejectNoNote = await api("PATCH", `/api/collections/user_missions/records/${claim1Id}`, { token: adminToken, body: { status: "rejected" } })
      check("tolak tanpa catatan → 400", rejectNoNote.status === 400, `status ${rejectNoNote.status}`)
      const reject = await api("PATCH", `/api/collections/user_missions/records/${claim1Id}`, { token: adminToken, body: { status: "rejected", review_note: "Foto kurang jelas" } })
      check("tolak dgn catatan → rejected (poin dipaksa server 0)", reject.status === 200 && reject.data?.status === "rejected" && reject.data?.points_awarded === 0, JSON.stringify(reject.data))
      const eNotif1 = await api("GET", "/api/collections/notifications/records", { token: eToken })
      check("notif 'Misi perlu diperbaiki' masuk", (eNotif1.data?.items || []).some((n) => n.title === "Misi perlu diperbaiki"), JSON.stringify(eNotif1.data?.items?.map((n) => n.title)))
      const ePts1 = await api("GET", `/api/collections/users/records/${eId}`, { token: eToken })
      check("tolak tidak memberi poin", ePts1.data?.points === 0, `points=${ePts1.data?.points}`)
      const reReview = await api("PATCH", `/api/collections/user_missions/records/${claim1Id}`, { token: adminToken, body: { status: "approved" } })
      check("review ulang klaim yang sudah diputuskan → 409", reReview.status === 409, `status ${reReview.status}`)
      const resub = await claimPost(eToken, photoM.data?.id, { consent: "1" }, PNG_RED)
      check("klaim ulang setelah ditolak → baris sama dipakai ulang", resub.status === 200 && resub.data?.claim?.id === claim1Id && resub.data?.claim?.status === "submitted", JSON.stringify(resub.data))
      const approve = await api("PATCH", `/api/collections/user_missions/records/${claim1Id}`, { token: adminToken, body: { status: "approved" } })
      check("approve → poin misi dipaksa server (6, bukan nilai klien)", approve.status === 200 && approve.data?.status === "approved" && approve.data?.points_awarded === 6, JSON.stringify(approve.data))
      check("approve mencatat reviewed_by", approve.data?.reviewed_by === bId, JSON.stringify(approve.data?.reviewed_by))
      const ePts2 = await api("GET", `/api/collections/users/records/${eId}`, { token: eToken })
      check("approve → users.points +6", ePts2.data?.points === 6, `points=${ePts2.data?.points}`)
      const eLedger = await api("GET", "/api/collections/point_transactions/records?filter=" + encodeURIComponent('source = "mission"'), { token: eToken })
      const missionLedger = (eLedger.data?.items || []).find((r) => r.amount === 6 && r.ref_id === claim1Id)
      check("approve → ledger append-only (source=mission, ref_id=klaim)", eLedger.data?.totalItems >= 1 && !!missionLedger, JSON.stringify(eLedger.data?.items))
      const eNotif2 = await api("GET", "/api/collections/notifications/records", { token: eToken })
      check("notif 'Misi disetujui!' masuk", (eNotif2.data?.items || []).some((n) => n.title === "Misi disetujui!"), JSON.stringify(eNotif2.data?.items?.map((n) => n.title)))
      const events = await api("GET", "/api/collections/analytics_events/records?filter=" + encodeURIComponent('name = "misi_selesai"'), { token: suToken })
      check("event misi_selesai tercatat (PRD §8)", events.data?.totalItems >= 1 && events.data.items.some((ev) => ev.user === eId), JSON.stringify(events.data?.totalItems))
      const eAfterApprove = await api("GET", `/api/collections/users/records/${eId}`, { token: eToken })
      check("streak ikut berdetak saat approve (1 hari, aktif hari ini)", eAfterApprove.data?.current_streak === 1 && String(eAfterApprove.data?.last_active_date || "").slice(0, 10) === today.slice(0, 10), JSON.stringify({ streak: eAfterApprove.data?.current_streak, last: eAfterApprove.data?.last_active_date }))
      const eBadges1 = await api("GET", "/api/ekoteologi/badges", { token: eToken })
      const misiBadge = (eBadges1.data || []).find((b) => b.code === "misi_pertama")
      check("badge engine on-event: misi_pertama diraih", eBadges1.status === 200 && misiBadge?.earned === true, JSON.stringify(misiBadge))
      check("notif 'Lencana baru' masuk", (eNotif2.data?.items || []).some((n) => /Lencana baru/.test(n.title || "")), JSON.stringify(eNotif2.data?.items?.map((n) => n.title)))
      const auditReview = await api("GET", "/api/collections/audit_logs/records?filter=" + encodeURIComponent('action = "update" && entity = "user_missions"'), { token: adminToken })
      check("keputusan review ter-audit (update user_missions)", auditReview.data?.totalItems >= 1, `total=${auditReview.data?.totalItems}`)

      // ── klaim manual: auto-approve + poin; auto_scan ditolak ──
      const manualClaim = await api("POST", `/api/ekoteologi/missions/${manual1.data?.id}/claim`, { token: eToken, body: {} })
      check("klaim manual → approved + poin 4", manualClaim.status === 200 && manualClaim.data?.claim?.status === "approved" && manualClaim.data?.claim?.points_awarded === 4, JSON.stringify(manualClaim.data))
      check("klaim manual membawa points_total (sinkron pill poin)", manualClaim.data?.points_total === 10, JSON.stringify(manualClaim.data))
      const manualDup = await api("POST", `/api/ekoteologi/missions/${manual1.data?.id}/claim`, { token: eToken, body: {} })
      check("anti dobel klaim manual → 409", manualDup.status === 409, JSON.stringify(manualDup.data))
      const autoClaim = await api("POST", `/api/ekoteologi/missions/${asAny.data?.id}/claim`, { token: eToken, body: {} })
      check("klaim misi auto_scan manual → 400 (progres dari scan)", autoClaim.status === 400, `status ${autoClaim.status}`)

      // ── misi weekly: periode dihitung server (Senin) ──
      const weeklyClaim = await claimPost(eToken, weeklyM.data?.id, { consent: "1" }, PNG_1PX)
      check("klaim misi weekly photo → submitted", weeklyClaim.status === 200 && weeklyClaim.data?.claim?.status === "submitted", JSON.stringify(weeklyClaim.data))
      const weeklyRec = await api("GET", `/api/collections/user_missions/records/${weeklyClaim.data?.claim?.id}`, { token: suToken })
      check("periode weekly = Senin minggu berjalan (server)", String(weeklyRec.data?.period_date || "").slice(0, 19) === monday.slice(0, 19), `period=${weeklyRec.data?.period_date} monday=${monday}`)
      const weeklyDup = await claimPost(eToken, weeklyM.data?.id, { consent: "1" }, PNG_RED)
      check("anti dobel klaim weekly → 409", weeklyDup.status === 409, JSON.stringify(weeklyDup.data))

      // ── auto_scan: progres dari scan (scan_category + required_count) ──
      const scan1 = await scanPost(eToken, PNG_1PX, "e1.png")
      check("scan E #1 → Logam 5 poin (cache hit)", scan1.status === 200 && scan1.data?.category?.name === "Logam" && scan1.data?.points === 5, JSON.stringify(scan1.data))
      const ePts3 = await api("GET", `/api/collections/users/records/${eId}`, { token: eToken })
      check("scan1: poin scan + misi Logam otomatis (5+5=+10)", ePts3.data?.points === 20, `points=${ePts3.data?.points}`)
      const logamClaim = await api("GET", "/api/collections/user_missions/records?filter=" + encodeURIComponent(`mission = "${asLogam.data?.id}" && user = "${eId}"`), { token: suToken })
      check("misi auto_scan Logam selesai otomatis (required 1)", logamClaim.data?.totalItems === 1 && logamClaim.data?.items?.[0]?.status === "approved" && logamClaim.data?.items?.[0]?.progress_count === 1, JSON.stringify(logamClaim.data))
      const anyClaim1 = await api("GET", "/api/collections/user_missions/records?filter=" + encodeURIComponent(`mission = "${asAny.data?.id}" && user = "${eId}"`), { token: suToken })
      check("misi auto_scan bebas kategori: progres 1/2 in_progress", anyClaim1.data?.totalItems === 1 && anyClaim1.data?.items?.[0]?.status === "in_progress" && anyClaim1.data?.items?.[0]?.progress_count === 1, JSON.stringify(anyClaim1.data))
      const filterClaim = await api("GET", "/api/collections/user_missions/records?filter=" + encodeURIComponent(`mission = "${asFilter.data?.id}" && user = "${eId}"`), { token: suToken })
      check("filter kategori: scan non-B3 tidak memajukan misi B3 (tidak ada klaim)", filterClaim.data?.totalItems === 0, JSON.stringify(filterClaim.data))
      const scan2 = await scanPost(eToken, PNG_RED, "e2.png")
      check("scan E #2 → Kertas 4 poin", scan2.status === 200 && scan2.data?.category?.name === "Kertas" && scan2.data?.points === 4, JSON.stringify(scan2.data))
      const ePts4 = await api("GET", `/api/collections/users/records/${eId}`, { token: eToken })
      check("scan2: +4 poin scan +8 misi Scan 2x = 32", ePts4.data?.points === 32, `points=${ePts4.data?.points}`)
      const anyClaim2 = await api("GET", "/api/collections/user_missions/records?filter=" + encodeURIComponent(`mission = "${asAny.data?.id}" && user = "${eId}"`), { token: suToken })
      check("misi auto_scan bebas kategori selesai otomatis (2/2)", anyClaim2.data?.totalItems === 1 && anyClaim2.data?.items?.[0]?.status === "approved" && anyClaim2.data?.items?.[0]?.progress_count === 2, JSON.stringify(anyClaim2.data))
      const eNotif3 = await api("GET", "/api/collections/notifications/records", { token: eToken })
      check("notif 'Misi selesai otomatis!' masuk", (eNotif3.data?.items || []).some((n) => n.title === "Misi selesai otomatis!"), JSON.stringify(eNotif3.data?.items?.map((n) => n.title)))
      const eBadges2 = await api("GET", "/api/ekoteologi/badges", { token: eToken })
      check("badge scan_pertama diraih otomatis dari scan", (eBadges2.data || []).find((b) => b.code === "scan_pertama")?.earned === true, JSON.stringify((eBadges2.data || []).filter((b) => b.earned).map((b) => b.code)))

      // scan duplikat (poin 0) tidak memajukan misi baru (anti poin-farming)
      const asDup = await mkMission({ title: "Misi Anti Duplikat", points: 6, verification: "auto_scan", required_count: 2, type: "daily", is_active: true })
      const scan3 = await scanPost(eToken, PNG_1PX, "e1.png")
      check("scan E #3 (foto sama) → duplikat, poin 0", scan3.status === 200 && scan3.data?.duplicate === true && scan3.data?.points === 0, JSON.stringify(scan3.data))
      const ePts5 = await api("GET", `/api/collections/users/records/${eId}`, { token: eToken })
      check("duplikat tidak menambah poin & progres", ePts5.data?.points === 32, `points=${ePts5.data?.points}`)
      const dupClaim = await api("GET", "/api/collections/user_missions/records?filter=" + encodeURIComponent(`mission = "${asDup.data?.id}" && user = "${eId}"`), { token: suToken })
      check("scan duplikat tidak membuat baris progres misi", dupClaim.data?.totalItems === 0, JSON.stringify(dupClaim.data))

      // ── streak: reset lazy + bonus kelipatan (env default 20/6) ──
      await api("PATCH", `/api/collections/users/records/${eId}`, {
        token: suToken,
        body: { current_streak: 5, longest_streak: 7, last_active_date: dAgo(3) },
      })
      const resetM = await mkMission({ title: "Misi Reset Streak", points: 3, verification: "manual", type: "daily", is_active: true })
      await api("POST", `/api/ekoteologi/missions/${resetM.data?.id}/claim`, { token: eToken, body: {} })
      const eStreak1 = await api("GET", `/api/collections/users/records/${eId}`, { token: eToken })
      check("streak reset ke 1 setelah bolong 3 hari (reset lazy)", eStreak1.data?.current_streak === 1 && String(eStreak1.data?.last_active_date || "").slice(0, 10) === today.slice(0, 10), JSON.stringify({ streak: eStreak1.data?.current_streak, last: eStreak1.data?.last_active_date }))
      await api("PATCH", `/api/collections/users/records/${eId}`, {
        token: suToken,
        body: { current_streak: 5, longest_streak: 7, last_active_date: dAgo(1) },
      })
      const bonusM = await mkMission({ title: "Misi Bonus Streak", points: 4, verification: "manual", type: "daily", is_active: true })
      await api("POST", `/api/ekoteologi/missions/${bonusM.data?.id}/claim`, { token: eToken, body: {} })
      const eStreak2 = await api("GET", `/api/collections/users/records/${eId}`, { token: eToken })
      check("streak 5 → 6 (lanjut kemarin)", eStreak2.data?.current_streak === 6, `streak=${eStreak2.data?.current_streak}`)
      check("bonus streak kelipatan 6 → +20 poin (35+4+20=59)", eStreak2.data?.points === 59, `points=${eStreak2.data?.points}`)
      const streakLedger = await api("GET", "/api/collections/point_transactions/records?filter=" + encodeURIComponent('source = "streak"'), { token: eToken })
      check("bonus streak lewat ledger (source=streak, +20)", streakLedger.data?.totalItems === 1 && streakLedger.data?.items?.[0]?.amount === 20, JSON.stringify(streakLedger.data))
      const eNotif4 = await api("GET", "/api/collections/notifications/records", { token: eToken })
      check("notif 'Bonus streak 6 hari!' masuk", (eNotif4.data?.items || []).some((n) => n.title === "Bonus streak 6 hari!"), JSON.stringify(eNotif4.data?.items?.map((n) => n.title)))
      const streakEvents = await api("GET", "/api/collections/analytics_events/records?filter=" + encodeURIComponent('name = "streak_hari"'), { token: suToken })
      check("event streak_hari tercatat (PRD §8)", streakEvents.data?.totalItems >= 1 && streakEvents.data.items.some((ev) => ev.user === eId), JSON.stringify(streakEvents.data?.totalItems))
      const idemM = await mkMission({ title: "Misi Idempoten Streak", points: 2, verification: "manual", type: "daily", is_active: true })
      await api("POST", `/api/ekoteologi/missions/${idemM.data?.id}/claim`, { token: eToken, body: {} })
      const streakLedger2 = await api("GET", "/api/collections/point_transactions/records?filter=" + encodeURIComponent('source = "streak"'), { token: eToken })
      check("aktivitas kedua di hari sama tidak menggandakan bonus", streakLedger2.data?.totalItems === 1, `total=${streakLedger2.data?.totalItems}`)
      const streakRoute = await api("GET", "/api/ekoteologi/streak", { token: eToken })
      check(
        "route streak: status efektif + kalender 7 hari + konfigurasi bonus",
        streakRoute.status === 200 &&
          streakRoute.data?.current_streak === 6 &&
          streakRoute.data?.longest_streak === 7 &&
          streakRoute.data?.active_today === true &&
          streakRoute.data?.bonus_points === 20 &&
          streakRoute.data?.bonus_every_days === 6 &&
          streakRoute.data?.days_to_bonus === 6 &&
          Array.isArray(streakRoute.data?.week) &&
          streakRoute.data.week.length === 7 &&
          streakRoute.data.week[6].active === true,
        JSON.stringify(streakRoute.data)
      )

      // ── level engine: recalc saat ledger bertambah ──
      const adj = await api("POST", "/api/collections/point_transactions/records", { token: suToken, body: { user: eId, amount: 500, source: "adjustment", note: "penyesuaian level uji" } })
      check("penyesuaian poin via ledger (sistem)", adj.status === 200)
      const eLevel = await api("GET", `/api/collections/users/records/${eId}`, { token: eToken })
      check("level engine: 561 poin → level 5 Aktivis Lingkungan", eLevel.data?.level === 5 && eLevel.data?.level_title === "Aktivis Lingkungan", JSON.stringify({ level: eLevel.data?.level, title: eLevel.data?.level_title, points: eLevel.data?.points }))

      // ── badge lazy sync (jalur non-event: penyesuaian admin) ──
      const adj2 = await api("POST", "/api/collections/point_transactions/records", { token: suToken, body: { user: eId, amount: 500, source: "adjustment", note: "menuju poin_1000" } })
      check("penyesuaian kedua berhasil", adj2.status === 200, JSON.stringify(adj2.data))
      const ePtsBefore = await api("GET", `/api/collections/users/records/${eId}`, { token: eToken })
      check("poin sebelum lazy sync >= 1000", (ePtsBefore.data?.points || 0) >= 1000, `points=${ePtsBefore.data?.points}`)
      const eLedgerSum = await api("GET", "/api/collections/point_transactions/records?perPage=50", { token: eToken })
      const sumAmounts = (eLedgerSum.data?.items || []).reduce((a, r) => a + (r.amount || 0), 0)
      check("total baris ledger E >= 1000 (sum klien)", sumAmounts >= 1000, `sum=${sumAmounts} rows=${eLedgerSum.data?.totalItems}`)
      const eBadges3 = await api("GET", "/api/ekoteologi/badges", { token: eToken })
      const earnedCodes = (eBadges3.data || []).filter((b) => b.earned).map((b) => b.code)
      check(
        "badge lazy: poin_1000 terbayar saat GET /badges",
        (eBadges3.data || []).find((b) => b.code === "poin_1000")?.earned === true,
        JSON.stringify(earnedCodes)
      )
      check("lencana di bawah target tetap terkunci (streak_7 sah dari rekor longest)", (eBadges3.data || []).find((b) => b.code === "misi_25")?.earned === false && (eBadges3.data || []).find((b) => b.code === "scan_10")?.earned === false, JSON.stringify(earnedCodes))
      const eNotif5 = await api("GET", "/api/collections/notifications/records", { token: eToken })
      check("notif 'Lencana baru: Seribu Kebaikan' masuk", (eNotif5.data?.items || []).some((n) => n.title === "Lencana baru: Seribu Kebaikan"), JSON.stringify(eNotif5.data?.items?.map((n) => n.title)))

      // ── cron reminder streak (trigger manual; cronAdd terdaftar server) ──
      const okF = await api("POST", "/api/collections/users/records", {
        body: { email: "fajar@ekoteologi.id", password: "RahasiaKu123", passwordConfirm: "RahasiaKu123", full_name: "Fajar Streak" },
      })
      const fId = okF.data?.id
      await api("PATCH", `/api/collections/users/records/${fId}`, {
        token: suToken,
        body: { current_streak: 3, longest_streak: 3, last_active_date: dAgo(1), is_active: true },
      })
      const remind1 = await api("POST", "/api/ekoteologi/cron/streak-reminder", { token: adminToken, body: {} })
      check("trigger reminder (admin) → terkirim >= 1", remind1.status === 200 && remind1.data?.sent >= 1, JSON.stringify(remind1.data))
      const fNotif = await api("GET", "/api/collections/notifications/records", { token: (await auth("users", "fajar@ekoteologi.id", "RahasiaKu123")) })
      check("user aktif kemarin menerima notif 'berisiko'", (fNotif.data?.items || []).some((n) => n.type === "streak" && /berisiko/.test(n.title || "")), JSON.stringify(fNotif.data?.items?.map((n) => n.title)))
      const remind2 = await api("POST", "/api/ekoteologi/cron/streak-reminder", { token: adminToken, body: {} })
      check("reminder idempoten per hari (trigger kedua → 0)", remind2.status === 200 && remind2.data?.sent === 0, JSON.stringify(remind2.data))
      const remindForb = await api("POST", "/api/ekoteologi/cron/streak-reminder", { token: eToken, body: {} })
      check("user biasa tidak bisa memicu reminder", remindForb.status === 401 || remindForb.status === 403, `status ${remindForb.status}`)

      // ── proteksi hapus misi yang punya klaim ──
      const delUsed = await api("DELETE", `/api/collections/missions/records/${photoM.data?.id}`, { token: suToken })
      check("hapus misi dgn klaim → 409 (jaga riwayat)", delUsed.status === 409, `status ${delUsed.status}`)
      const freshM = await mkMission({ title: "Misi Boleh Dihapus", points: 1, verification: "manual", type: "daily", is_active: false })
      const delFresh = await api("DELETE", `/api/collections/missions/records/${freshM.data?.id}`, { token: suToken })
      check("hapus misi tanpa klaim tetap bisa", delFresh.status === 200 || delFresh.status === 204, `status ${delFresh.status}`)
    }

    console.log(`\nHasil: ${passed} PASS, ${failed} FAIL`)
    process.exitCode = failed === 0 ? 0 : 1
  } finally {
    stopServer()
  }
}

main().catch((err) => {
  console.error("FATAL:", err?.message || err)
  stopServer()
  process.exit(1)
})
