#!/usr/bin/env node
/**
 * Sprint 9 — verifikasi fondasi PocketBase (pengganti pytest api).
 * Sprint 10 — +rate limit settings, audit log, guard login, autodate.
 * Sprint 11 — +route scan AI (mock), cache llm_cache + hit rate, kuota harian,
 *             ledger append-only + sinkron users.points.
 * Sprint 13 — +e-learning (kuis server-side + anti dobel poin), konten
 *             harian + cron publish, broadcast & pipeline push FCM (mock
 *             OAuth/FCM — JWT RS256 diverifikasi), dashboard agregasi,
 *             cleanup app_settings/llm_cache, backup, guard read_at, dan
 *             instance fault-injection utk rollback review + fallback log.
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
 *  10. Misi, verifikasi & gamifikasi: klaim 3 mode, engine review, level,
 *      streak, badge, cron reminder (sprint 12)
 *  11. E-learning: modul/pelajaran/kuis server-side, anti dobel poin per
 *      modul, event/streak/badge, koleksi soal terkunci (sprint 13)
 *  12. Konten harian: route wisdom card + cron auto-publish idempoten
 *  13. Broadcast & push FCM: segmen, composer admin, pipeline push mode fcm
 *      via endpoint mock (OAuth JWT RS256 + messages:send + token mati 410)
 *  14. Ops: dashboard agregasi, cleanup kedaluwarsa, backup, guard read_at
 *  15. Instance fault-injection: rollback full-atomik review + Sentry +
 *      fallback push mode=log
 *
 * Jalankan: make pb-test   (butuh binary ./pocketbase — `make pb-install`)
 */
import { spawn, spawnSync } from "node:child_process"
import { rmSync, writeFileSync, mkdtempSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import os from "node:os"
import net from "node:net"
import http from "node:http"
import crypto from "node:crypto"

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

// ── mock Google endpoints (OAuth token + FCM v1) + mock Sentry store ──
// Kredensial FCM asli item terbuka (sejak Sprint 6) — alur push FCM diuji
// terhadap endpoint mock lokal; JWT RS256 yang dibuat hook diverifikasi
// sungguhan dgn crypto Node (server Python/Go tidak ikut campur).
const mockState = {
  oauth: { claims: [] },
  fcm: { calls: [] },
  sentry: [],
}
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const SA_FILE = path.join(mkdtempSync(path.join(os.tmpdir(), "fcm-sa-")), "sa.json")
writeFileSync(
  SA_FILE,
  JSON.stringify({
    client_email: "ekoteologi-test@ekoteologi-test.iam.gserviceaccount.com",
    private_key: PRIVATE_PEM,
    project_id: "ekoteologi-test",
  })
)
const mockHttp = http.createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/oauth") {
      const assertion = new URLSearchParams(body).get("assertion") || ""
      const [h, p, s] = assertion.split(".")
      let ok = false
      let claims = null
      try {
        ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))
        claims = JSON.parse(Buffer.from(p, "base64url").toString())
      } catch {
        ok = false
      }
      mockState.oauth.claims.push({ ok, claims })
      if (!ok) {
        res.statusCode = 401
        return res.end("{}")
      }
      return res.end(JSON.stringify({ access_token: "mock-oauth-token", expires_in: 3600 }))
    }
    if (req.url.startsWith("/fcm")) {
      let payload = {}
      try {
        payload = JSON.parse(body || "{}")
      } catch {}
      const token = payload?.message?.token || ""
      mockState.fcm.calls.push({
        auth: req.headers["authorization"] || "",
        token,
        title: payload?.message?.notification?.title || "",
      })
      if (token.startsWith("DEAD")) {
        res.statusCode = 410 // token perangkat mati → hook menghapus barisnya
        return res.end("{}")
      }
      return res.end(JSON.stringify({ name: "projects/ekoteologi-test/messages/" + mockState.fcm.calls.length }))
    }
    if (/^\/api\/\d+\/store\/?$/.test(req.url)) {
      try {
        mockState.sentry.push(JSON.parse(body || "{}"))
      } catch {
        mockState.sentry.push({ raw: body })
      }
      return res.end("{}")
    }
    res.statusCode = 404
    res.end("{}")
  })
})

async function startMock() {
  await new Promise((resolve) => mockHttp.listen(0, "127.0.0.1", resolve))
  mockHttp.unref() // jangan tahan proses uji tetap hidup
  return mockHttp.address().port
}
const MOCK_PORT = await startMock()
const MOCK = `http://127.0.0.1:${MOCK_PORT}`

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
      // Kuota harian kecil agar uji 429 murah; push mode fcm dgn kredensial
      // service account tiruan + endpoint OAuth/FCM mock (env hanya instance uji).
      env: {
        ...process.env,
        SCAN_DAILY_LIMIT: "3",
        LLM_MODE: "mock",
        PUSH_MODE: "fcm",
        FCM_PROJECT_ID: "ekoteologi-test",
        FCM_CREDENTIALS_FILE: SA_FILE,
        FCM_OAUTH_URL: `${MOCK}/oauth`,
        FCM_SEND_URL: `${MOCK}/fcm`,
      },
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

    // ── 11. e-learning: kuis server-side + anti dobel poin (sprint 13) ──
    console.log("[11] Sprint 13: e-learning — penilaian kuis server-side & anti dobel poin")
    let quizModuleId = ""
    let lesson1Id = ""
    let lesson2Id = ""
    {
      // user G — protagonis e-learning (poin mulai 0)
      const okG = await api("POST", "/api/collections/users/records", {
        body: { email: "gita@ekoteologi.id", password: "RahasiaKu123", passwordConfirm: "RahasiaKu123", full_name: "Gita Belajar" },
      })
      check("registrasi user G", okG.status === 200)
      const gId = okG.data?.id
      const gToken = await auth("users", "gita@ekoteologi.id", "RahasiaKu123")

      // modul + 2 pelajaran + kuis 4 soal (superuser — konten belajar)
      const mod = await api("POST", "/api/collections/modules/records", {
        token: suToken,
        body: { title: "Modul Uji Sprint 13", slug: "modul-uji-13", description: "Modul e-learning uji", cover: "fa-leaf", order: 1, is_published: true },
      })
      quizModuleId = mod.data?.id
      const les1 = await api("POST", "/api/collections/lessons/records", {
        token: suToken,
        body: { module: quizModuleId, title: "Pelajaran Pertama", order: 0, content: [
          { type: "paragraph", text: "Khalifah di bumi menjaga amanahnya." },
          { type: "quote", text: "Dunia itu hijau dan manis.", arabic: "حُُط", source: "HR Muslim no. 2742" },
          { type: "tip", text: "Pilah sampah dari rumah." },
        ] },
      })
      lesson1Id = les1.data?.id
      const les2 = await api("POST", "/api/collections/lessons/records", {
        token: suToken,
        body: { module: quizModuleId, title: "Pelajaran Kedua", order: 1, content: [{ type: "paragraph", text: "Lanjutan materi." }] },
      })
      lesson2Id = les2.data?.id
      const quiz = await api("POST", "/api/collections/quizzes/records", {
        token: suToken,
        body: { module: quizModuleId },
      })
      const answers = [1, 2, 0, 3]
      const questionIds = []
      for (let i = 0; i < 4; i++) {
        const q = await api("POST", "/api/collections/quiz_questions/records", {
          token: suToken,
          body: {
            quiz: quiz.data?.id,
            question: `Soal ${i + 1}: pilih jawaban benar?`,
            options: ["A", "B", "C", "D"],
            answer: answers[i],
            explanation: `Penjelasan soal ${i + 1}.`,
            order: i + 1,
          },
        })
        questionIds.push(q.data?.id)
      }
      check(
        "modul/pelajaran/kuis/soal dibuat admin",
        mod.status === 200 && les1.status === 200 && les2.status === 200 && quiz.status === 200 && questionIds.every(Boolean)
      )

      // koleksi terkunci: bank soal & progres tidak bisa dibaca/tulis klien
      const soalByUser = await api("GET", "/api/collections/quiz_questions/records", { token: gToken })
      check("bank soal TIDAK terbaca user (kunci sprint 13 — kunci jawaban aman)", soalByUser.status === 200 && soalByUser.data?.totalItems === 0, `total=${soalByUser.data?.totalItems}`)
      const soalBySu = await api("GET", "/api/collections/quiz_questions/records", { token: suToken })
      check("bank soal tetap terbaca superuser/editor", soalBySu.data?.totalItems === 4)
      const attemptWrite = await api("POST", "/api/collections/user_quiz_attempts/records", {
        token: gToken,
        body: { user: gId, quiz: quiz.data?.id, score: 99, total: 4, passed: true, points_awarded: 999 },
      })
      check("user TIDAK bisa menulis user_quiz_attempts (anti manen lencana)", attemptWrite.status >= 400, `status ${attemptWrite.status}`)
      const progressWrite = await api("POST", "/api/collections/user_module_progress/records", {
        token: gToken,
        body: { user: gId, module: quizModuleId, lessons_done: 99, is_completed: true },
      })
      check("user TIDAK bisa menulis user_module_progress (progres via route)", progressWrite.status >= 400, `status ${progressWrite.status}`)

      // daftar modul: kartu + progres + cta
      const list = await api("GET", "/api/ekoteologi/modules", { token: gToken })
      const card = (list.data?.items || []).find((m) => m.id === quizModuleId)
      check(
        "GET /modules: kartu modul (2 pelajaran, 4 soal, poin 20, CTA Mulai)",
        list.status === 200 && !!card && card.lesson_count === 2 && card.quiz_question_count === 4 &&
          card.quiz_points === 20 && card.progress.lessons_done === 0 && card.cta === "Mulai",
        JSON.stringify(card)
      )
      check("GET /modules: ringkasan N/M + modul draf tidak bocor", list.data?.summary?.total >= 1 && list.data?.summary?.completed === 0 && !(list.data?.items || []).some((m) => m.title === "Modul Draf"))
      const listAnon = await api("GET", "/api/ekoteologi/modules")
      check("GET /modules tanpa token → 401", listAnon.status === 401)

      // detail modul: soal TANPA kunci + quiz_best kosong
      const detail = await api("GET", `/api/ekoteologi/modules/${quizModuleId}`, { token: gToken })
      check(
        "GET /modules/{id}: pelajaran urut + intro kuis tanpa kunci jawaban",
        detail.status === 200 && detail.data?.lessons?.length === 2 && detail.data?.quiz?.question_count === 4 &&
          detail.data?.quiz?.questions?.every((q) => !("answer" in q) && !("explanation" in q)),
        JSON.stringify(detail.data?.quiz)
      )
      check("GET /modules/{id}: quiz_best kosong sebelum percobaan", detail.data?.quiz_best === null)

      // 404 & validasi
      const nf = await api("GET", "/api/ekoteologi/modules/tidakada", { token: gToken })
      check("modul tak dikenal → 404", nf.status === 404)
      const emptyAnswers = await api("POST", `/api/ekoteologi/modules/${quizModuleId}/quiz`, {
        token: gToken,
        body: { answers: [] },
      })
      check("submit kuis tanpa jawaban cocok → 400", emptyAnswers.status === 400, JSON.stringify(emptyAnswers.data))

      // percobaan 1: gagal (2/4 = 50% < 70%) — attempt tersimpan, tanpa poin
      const fail = await api("POST", `/api/ekoteologi/modules/${quizModuleId}/quiz`, {
        token: gToken,
        body: { answers: [{ question_id: questionIds[0], choice: 1 }, { question_id: questionIds[1], choice: 2 }] },
      })
      check(
        "kuis gagal (50%): passed=false, poin 0, attempt tercatat",
        fail.status === 200 && fail.data?.passed === false && fail.data?.percent === 50 && fail.data?.points_awarded === 0 && fail.data?.points_total === 0,
        JSON.stringify(fail.data)
      )
      const attempts1 = await api("GET", "/api/collections/user_quiz_attempts/records", { token: suToken })
      check("attempt gagal tercatat (riwayat, passed=false)", attempts1.data?.totalItems === 1)

      // percobaan 2: lulus 4/4 → +20 poin SEKALI (ledger + notif + event + streak)
      const pass = await api("POST", `/api/ekoteologi/modules/${quizModuleId}/quiz`, {
        token: gToken,
        body: { answers: answers.map((choice, i) => ({ question_id: questionIds[i], choice })) },
      })
      const attemptId = (await api("GET", "/api/collections/user_quiz_attempts/records?sort=-created", { token: suToken })).data?.items?.[0]?.id
      check(
        "kuis lulus (100%): poin 20 diputuskan server + review penuh",
        pass.status === 200 && pass.data?.passed === true && pass.data?.points_awarded === 20 &&
          pass.data?.points_total === 20 && pass.data?.already_passed_before === false &&
          pass.data?.review?.every((r) => r.correct === true && typeof r.answer === "number" && !!r.explanation),
        JSON.stringify(pass.data)
      )
      check("pesan lulus berbahasa Indonesia dgn poin", /lulus/i.test(pass.data?.message || "") && /20 poin/.test(pass.data?.message || ""))
      const gAfter = await api("GET", `/api/collections/users/records/${gId}`, { token: gToken })
      check("users.points tersinkron (ledger hook): 20", gAfter.data?.points === 20, `points=${gAfter.data?.points}`)
      check("streak ikut berdetak saat kuis lulus", gAfter.data?.current_streak === 1, JSON.stringify({ s: gAfter.data?.current_streak }))
      const quizLedger = await api("GET", "/api/collections/point_transactions/records?filter=" + encodeURIComponent('source = "quiz"'), { token: gToken })
      check("ledger append-only source=quiz ref_id=attempt", quizLedger.data?.totalItems === 1 && quizLedger.data?.items?.[0]?.amount === 20 && quizLedger.data?.items?.[0]?.ref_id === attemptId, JSON.stringify(quizLedger.data))
      const gNotif = await api("GET", "/api/collections/notifications/records", { token: gToken })
      check("notif 'Poin kuis masuk' utk user", (gNotif.data?.items || []).some((n) => n.title === "Poin kuis masuk"))
      const quizEvents = await api("GET", "/api/collections/analytics_events/records?filter=" + encodeURIComponent('name = "modul_selesai"'), { token: suToken })
      check("event modul_selesai source=kuis tercatat (PRD §8)", (quizEvents.data?.items || []).some((ev) => ev.user === gId && ev.payload?.source === "kuis"), JSON.stringify(quizEvents.data?.items))

      // anti dobel poin: lulus lagi → tetap lulus, 0 poin
      const passAgain = await api("POST", `/api/ekoteologi/modules/${quizModuleId}/quiz`, {
        token: gToken,
        body: { answers: answers.map((choice, i) => ({ question_id: questionIds[i], choice })) },
      })
      check(
        "anti dobel poin: lulus ulang → already_passed_before, 0 poin",
        passAgain.status === 200 && passAgain.data?.passed === true && passAgain.data?.points_awarded === 0 &&
          passAgain.data?.already_passed_before === true && passAgain.data?.points_total === 20,
        JSON.stringify(passAgain.data)
      )
      const gAfter2 = await api("GET", `/api/collections/users/records/${gId}`, { token: gToken })
      check("poin tidak berubah setelah lulus ulang", gAfter2.data?.points === 20)

      // badge kuis terbuka otomatis (badge engine menghitung quiz_passed)
      const quizBadge = await api("POST", "/api/collections/badges/records", {
        token: suToken,
        body: { code: "kuis_uji", name: "Kuis Pertama", criteria: { type: "quiz_passed", value: 1 } },
      })
      check("badge kuis_uji dibuat admin", quizBadge.status === 200)
      const gBadges = await api("GET", "/api/ekoteologi/badges", { token: gToken })
      check("badge quiz_passed diraih otomatis setelah kuis lulus", (gBadges.data || []).find((b) => b.code === "kuis_uji")?.earned === true, JSON.stringify((gBadges.data || []).filter((b) => b.earned).map((b) => b.code)))

      // pelajaran: detail → complete berurutan → modul selesai (sekali)
      const lessonDetail = await api("GET", `/api/ekoteologi/lessons/${lesson1Id}`, { token: gToken })
      check(
        "GET /lessons/{id}: blok paragraph/quote/tip + next_lesson_id",
        lessonDetail.status === 200 && lessonDetail.data?.blocks?.length === 3 &&
          lessonDetail.data?.blocks?.[1]?.type === "quote" && lessonDetail.data?.next_lesson_id === lesson2Id,
        JSON.stringify(lessonDetail.data)
      )
      const complete1 = await api("POST", `/api/ekoteologi/lessons/${lesson1Id}/complete`, { token: gToken, body: {} })
      check(
        "complete pelajaran 1 → progres 1/2, belum selesai modul",
        complete1.status === 200 && complete1.data?.lessons_done === 1 && complete1.data?.just_completed === false,
        JSON.stringify(complete1.data)
      )
      const complete2 = await api("POST", `/api/ekoteologi/lessons/${lesson2Id}/complete`, { token: gToken, body: {} })
      check(
        "complete pelajaran 2 → modul selesai (transisi sekali)",
        complete2.status === 200 && complete2.data?.lessons_done === 2 && complete2.data?.is_completed === true && complete2.data?.just_completed === true,
        JSON.stringify(complete2.data)
      )
      const completeAgain = await api("POST", `/api/ekoteologi/lessons/${lesson1Id}/complete`, { token: gToken, body: {} })
      check(
        "complete ulang pelajaran lama tidak menurunkan/menggandakan",
        completeAgain.data?.lessons_done === 2 && completeAgain.data?.just_completed === false,
        JSON.stringify(completeAgain.data)
      )
      const lessonEvents = await api("GET", "/api/collections/analytics_events/records?filter=" + encodeURIComponent('name = "modul_selesai"'), { token: suToken })
      const gLessonEvents = (lessonEvents.data?.items || []).filter((ev) => ev.user === gId)
      check("event modul_selesai persis 2 utk G (kuis + pelajaran)", gLessonEvents.length === 2 && gLessonEvents.some((ev) => ev.payload?.source === "pelajaran"), JSON.stringify(gLessonEvents.map((ev) => ev.payload?.source)))
      const listAfter = await api("GET", "/api/ekoteologi/modules", { token: gToken })
      const cardAfter = (listAfter.data?.items || []).find((m) => m.id === quizModuleId)
      check("kartu modul kini 100% + CTA Ulangi + ringkasan completed", cardAfter?.progress?.percent === 100 && cardAfter?.cta === "Ulangi" && listAfter.data?.summary?.completed === 1, JSON.stringify(cardAfter))
      const lesson404 = await api("GET", "/api/ekoteologi/lessons/tidakada", { token: gToken })
      check("pelajaran tak dikenal → 404", lesson404.status === 404)

      // kuis modul tanpa kuis → 404 ramah
      const bare = await api("POST", "/api/collections/modules/records", { token: suToken, body: { title: "Modul Tanpa Kuis", slug: "tanpa-kuis", is_published: true } })
      const noQuiz = await api("GET", `/api/ekoteologi/modules/${bare.data?.id}/quiz`, { token: gToken })
      check("modul tanpa kuis → 404 'belum memiliki kuis'", noQuiz.status === 404 && /kuis/.test(noQuiz.data?.message || ""))
    }

    // ── 12. konten harian: wisdom card + cron auto-publish (sprint 13) ──
    console.log("[12] Sprint 13: konten harian — route wisdom card + cron publish")
    {
      const gToken = await auth("users", "gita@ekoteologi.id", "RahasiaKu123")
      const fallback = await api("GET", "/api/ekoteologi/daily-content", { token: gToken })
      check(
        "GET /daily-content tanpa jadwal → fallback bank quote (selalu 200)",
        fallback.status === 200 && fallback.data?.fallback === true && fallback.data?.type === "fallback" &&
          !!fallback.data?.body && !!fallback.data?.source,
        JSON.stringify(fallback.data)
      )
      const pad = (n) => String(n).padStart(2, "0")
      const todayStr = (() => {
        const d = new Date()
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      })()
      const sched = await api("POST", "/api/collections/daily_contents/records", {
        token: suToken,
        body: { publish_date: `${todayStr} 00:00:00.000Z`, type: "ayat", title: "Kartu Uji", body: "Konten terjadwal admin", eco_action: "Uji aksi hari ini" },
      })
      check("admin membuat konten terjadwal hari ini", sched.status === 200)
      const scheduled = await api("GET", "/api/ekoteologi/daily-content", { token: gToken })
      check(
        "GET /daily-content → konten terjadwal admin (fallback=false)",
        scheduled.status === 200 && scheduled.data?.fallback === false && scheduled.data?.body === "Konten terjadwal admin" && scheduled.data?.eco_action === "Uji aksi hari ini",
        JSON.stringify(scheduled.data)
      )
      const trigBusy = await api("POST", "/api/ekoteologi/cron/daily-content", { token: adminToken, body: {} })
      check("cron publish saat sudah ada jadwal → created 0 (tak menimpa)", trigBusy.status === 200 && trigBusy.data?.created === 0, JSON.stringify(trigBusy.data))
      await api("DELETE", `/api/collections/daily_contents/records/${sched.data?.id}`, { token: suToken })
      const trig = await api("POST", "/api/ekoteologi/cron/daily-content", { token: adminToken, body: {} })
      check("cron publish → konten hari ini terbit dari bank", trig.status === 200 && trig.data?.created === 1, JSON.stringify(trig.data))
      const after = await api("GET", "/api/ekoteologi/daily-content", { token: gToken })
      check(
        "auto-publish: fallback=false, body = rotasi bank, eco_action terisi",
        after.data?.fallback === false && after.data?.body === fallback.data?.body && !!after.data?.eco_action,
        JSON.stringify(after.data)
      )
      const trigAgain = await api("POST", "/api/ekoteologi/cron/daily-content", { token: adminToken, body: {} })
      check("cron publish idempoten (trigger kedua → 0)", trigAgain.data?.created === 0)
      const trigUser = await api("POST", "/api/ekoteologi/cron/daily-content", { token: gToken, body: {} })
      check("user biasa tidak bisa memicu publish", trigUser.status === 401 || trigUser.status === 403)
    }

    // ── 13. broadcast & pipeline push FCM (endpoint mock) ──
    console.log("[13] Sprint 13: broadcast composer + push FCM HTTP v1 (mock) + token mati")
    {
      // token perangkat milik A (createRule OWN): satu hidup, satu mati
      const tok1 = await api("POST", "/api/collections/fcm_tokens/records", { token: aToken, body: { user: aId, token: "tok-A1-hidup" } })
      const tok2 = await api("POST", "/api/collections/fcm_tokens/records", { token: aToken, body: { user: aId, token: "DEAD-A2-mati" } })
      check("token FCM terdaftar milik A", tok1.status === 200 && tok2.status === 200, JSON.stringify({ tok1: tok1.status, tok2: tok2.status }))

      const segs = await api("GET", "/api/ekoteologi/admin/push/segments", { token: adminToken })
      const segAll = (segs.data?.items || []).find((s) => s.segment === "all")
      const segTok = (segs.data?.items || []).find((s) => s.segment === "bertoken")
      check(
        "GET /admin/push/segments: 4 segmen + rekap penerima/token",
        segs.status === 200 && segs.data?.items?.length === 4 && segAll?.recipients >= 6 && segTok?.tokens === 2,
        JSON.stringify(segs.data)
      )
      const segUser = await api("GET", "/api/ekoteologi/admin/push/segments", { token: aToken })
      check("segmen hanya utk admin", segUser.status === 401 || segUser.status === 403)

      const fcmCallsBefore = mockState.fcm.calls.length
      const bc = await api("POST", "/api/ekoteologi/admin/push/broadcast", {
        token: adminToken,
        body: { title: "Pengumuman Uji Sprint 13", body: "Halo seluruh pengguna Ekoteologi!", segment: "all" },
      })
      check(
        "POST /admin/push/broadcast → rekap penerima/token/terkirim",
        bc.status === 200 && bc.data?.recipients >= 6 && bc.data?.tokens === 2 && bc.data?.sent === 1,
        JSON.stringify(bc.data)
      )
      const calls = mockState.fcm.calls.slice(fcmCallsBefore)
      check(
        "FCM v1 mock menerima pesan dgn Bearer access token",
        calls.length === 2 && calls.every((c) => c.auth === "Bearer mock-oauth-token") && calls.some((c) => c.token === "tok-A1-hidup") && calls.some((c) => c.token === "DEAD-A2-mati"),
        JSON.stringify(calls)
      )
      check(
        "OAuth mock: JWT RS256 diverifikasi crypto Node + klaim service account",
        mockState.oauth.claims.length === 1 && mockState.oauth.claims[0].ok === true &&
          mockState.oauth.claims[0].claims?.iss === "ekoteologi-test@ekoteologi-test.iam.gserviceaccount.com" &&
          /firebase\.messaging/.test(mockState.oauth.claims[0].claims?.scope || "") &&
          mockState.oauth.claims[0].claims?.aud?.endsWith("/oauth"),
        JSON.stringify(mockState.oauth.claims)
      )
      const tokLeft = await api("GET", "/api/collections/fcm_tokens/records", { token: aToken })
      check("token mati (410) dihapus otomatis dari fcm_tokens", tokLeft.data?.totalItems === 1 && tokLeft.data?.items?.[0]?.token === "tok-A1-hidup", JSON.stringify(tokLeft.data?.items?.map((t) => t.token)))
      const bcRow = await api("GET", "/api/collections/notifications/records?filter=" + encodeURIComponent('title = "Pengumuman Uji Sprint 13"'), { token: aToken })
      const bcRec = bcRow.data?.items?.[0]
      check(
        "baris broadcast (user kosong) + rekap push di payload",
        bcRow.data?.totalItems === 1 && bcRec?.payload?.kind === "broadcast" && bcRec?.payload?.push?.sent === 1 && bcRec?.payload?.push?.dead === 1 && bcRec?.payload?.push?.mode === "fcm",
        JSON.stringify(bcRec?.payload)
      )
      const bcAudit = await api("GET", "/api/collections/audit_logs/records?filter=" + encodeURIComponent('action = "push.broadcast"'), { token: adminToken })
      check("broadcast ter-audit (action=push.broadcast + rekap)", bcAudit.data?.totalItems === 1 && bcAudit.data?.items?.[0]?.diff?.sent === 1, JSON.stringify(bcAudit.data?.items?.[0]?.diff))

      // push event user (sumber = notifikasi in-app): klaim manual → notif → push 1 token
      const fcmCallsBefore2 = mockState.fcm.calls.length
      const mBaru = await api("POST", "/api/collections/missions/records", { token: suToken, body: { title: "Misi Push Uji", points: 5, verification: "manual", is_active: true } })
      await api("POST", `/api/ekoteologi/missions/${mBaru.data?.id}/claim`, { token: aToken, body: {} })
      const notifA = await api("GET", "/api/collections/notifications/records?sort=-created&filter=" + encodeURIComponent('title = "Poin misi masuk"'), { token: aToken })
      const notifRec = notifA.data?.items?.[0]
      check(
        "notifikasi event user → push ke token miliknya (payload.push rekap)",
        !!notifRec && notifRec?.payload?.push?.sent === 1 && notifRec?.payload?.push?.mode === "fcm",
        JSON.stringify(notifRec?.payload)
      )
      const calls2 = mockState.fcm.calls.slice(fcmCallsBefore2)
      check("FCM menerima pesan event (token tok-A1)", calls2.some((c) => c.token === "tok-A1-hidup" && /poin/i.test(c.title)), JSON.stringify(calls2))
      check("OAuth di-cache (token dipakai ulang, tanpa tukar baru)", mockState.oauth.claims.length === 1, `hits=${mockState.oauth.claims.length}`)

      // event misi baru → broadcast otomatis
      const newMissionNotif = await api("GET", "/api/collections/notifications/records?filter=" + encodeURIComponent('title = "Misi baru!"'), { token: aToken })
      check(
        'event "misi baru" → broadcast otomatis (paritas Sprint 8)',
        newMissionNotif.data?.totalItems >= 1 && newMissionNotif.data?.items?.[0]?.payload?.kind === "new_mission",
        JSON.stringify(newMissionNotif.data?.items?.[0]?.payload)
      )

      // validasi composer
      const badTitle = await api("POST", "/api/ekoteologi/admin/push/broadcast", { token: adminToken, body: { title: "ha", body: "isi yang cukup panjang", segment: "all" } })
      const badSeg = await api("POST", "/api/ekoteologi/admin/push/broadcast", { token: adminToken, body: { title: "Judul Sah", body: "isi yang cukup panjang", segment: "semua" } })
      const notAdmin = await api("POST", "/api/ekoteologi/admin/push/broadcast", { token: aToken, body: { title: "Judul Sah", body: "isi yang cukup panjang", segment: "all" } })
      check("validasi composer: judul pendek 400, segmen asing 400, non-admin 401/403", badTitle.status === 400 && badSeg.status === 400 && (notAdmin.status === 401 || notAdmin.status === 403), JSON.stringify([badTitle.status, badSeg.status, notAdmin.status]))
    }

    // ── 14. ops: dashboard, cleanup, backup, guard read_at (sprint 13) ──
    console.log("[14] Sprint 13: ops — dashboard agregasi, cleanup, backup, guard notifikasi")
    {
      const dash = await api("GET", "/api/ekoteologi/admin/dashboard", { token: adminToken })
      check(
        "GET /admin/dashboard: KPI pengguna/scan/verifikasi",
        dash.status === 200 && dash.data?.users?.total >= 7 && dash.data?.scans?.total >= 7 && dash.data?.verification?.pending >= 1,
        JSON.stringify({ u: dash.data?.users, s: dash.data?.scans, v: dash.data?.verification })
      )
      check(
        "dashboard: cache hit rate 75% + token LLM mock 0",
        dash.data?.cache?.hit === 6 && dash.data?.cache?.miss === 2 && dash.data?.cache?.hit_rate === 75 && dash.data?.llm?.tokens_month === 0,
        JSON.stringify(dash.data?.cache)
      )
      check(
        "dashboard chart: 14 hari + kategori terurut dgn persentase",
        dash.data?.charts?.daily?.length === 14 && (dash.data?.charts?.daily?.at(-1)?.count || 0) >= 7 &&
          (dash.data?.charts?.categories?.length || 0) >= 1 && dash.data?.charts?.categories?.[0]?.percentage > 0,
        JSON.stringify(dash.data?.charts)
      )
      const dashUser = await api("GET", "/api/ekoteologi/admin/dashboard", { token: aToken })
      check("dashboard hanya utk staff (user biasa ditolak)", dashUser.status === 401 || dashUser.status === 403)

      // cleanup kunci kedaluwarsa
      const pad = (n) => String(n).padStart(2, "0")
      const todayStr = (() => {
        const d = new Date()
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      })()
      const yesterdayMs = Date.now() - 16 * 60 * 1000
      await api("POST", "/api/collections/app_settings/records", { token: suToken, body: { key: "sr:legacyuser:2026-01-01", value: { sent_at: "lama" } } })
      await api("POST", "/api/collections/app_settings/records", { token: suToken, body: { key: `scan_quota:${aId}:2020-01-05`, value: 3 } })
      await api("POST", "/api/collections/app_settings/records", { token: suToken, body: { key: "sd:legacyuser:2019-12-31", value: "abc" } })
      await api("POST", "/api/collections/app_settings/records", { token: suToken, body: { key: "login_guard:stale@x.id", value: { start: yesterdayMs, count: 3 } } })
      await api("POST", "/api/collections/app_settings/records", { token: suToken, body: { key: `sr:${aId}:${todayStr}`, value: { sent_at: "hari ini" } } })
      await api("POST", "/api/collections/app_settings/records", { token: suToken, body: { key: "login_guard:fresh@x.id", value: { start: Date.now(), count: 1 } } })
      await api("POST", "/api/collections/llm_cache/records", { token: suToken, body: { key: "scan:expired", value: { x: 1 }, expires: "2020-01-01 00:00:00.000Z" } })
      await api("POST", "/api/collections/llm_cache/records", { token: suToken, body: { key: "scan:valid", value: { x: 2 }, expires: "2099-01-01 00:00:00.000Z" } })
      const clean = await api("POST", "/api/ekoteologi/cron/cleanup", { token: adminToken, body: {} })
      check(
        "cron cleanup: kunci kedaluwarsa + llm_cache kadaluarsa dibuang",
        clean.status === 200 && clean.data?.settings_removed >= 4 && clean.data?.cache_removed >= 1,
        JSON.stringify(clean.data)
      )
      const checkKey = async (key) => {
        const r = await api("GET", "/api/collections/app_settings/records?filter=" + encodeURIComponent(`key = "${key}"`), { token: suToken })
        return r.data?.totalItems || 0
      }
      check("kunci sr/scan_quota/sd/login_guard kedaluwarsa hilang", (await checkKey("sr:legacyuser:2026-01-01")) === 0 && (await checkKey(`scan_quota:${aId}:2020-01-05`)) === 0 && (await checkKey("sd:legacyuser:2019-12-31")) === 0 && (await checkKey("login_guard:stale@x.id")) === 0)
      check("kunci segar tetap (sr hari ini, guard dalam jendela, cache OAuth FCM)", (await checkKey(`sr:${aId}:${todayStr}`)) === 1 && (await checkKey("login_guard:fresh@x.id")) === 1 && (await checkKey("fcm:tk:ekoteologi-test")) === 1)
      const validCache = await api("GET", "/api/collections/llm_cache/records?filter=" + encodeURIComponent('key = "scan:valid"'), { token: suToken })
      check("llm_cache masih sah tidak ikut terhapus", validCache.data?.totalItems === 1)
      const cleanUser = await api("POST", "/api/ekoteologi/cron/cleanup", { token: aToken, body: {} })
      check("cleanup hanya utk admin", cleanUser.status === 401 || cleanUser.status === 403)

      // backup: jadwal bawaan PB (migrasi) + route manual
      const settings = await api("GET", "/api/settings", { token: suToken })
      check(
        "backup otomatis bawaan PB terjadwal dari migrasi (BACKUP_CRON default)",
        settings.data?.backups?.cron === "0 2 * * *" && settings.data?.backups?.cronMaxKeep === 7,
        JSON.stringify(settings.data?.backups)
      )
      const backup = await api("POST", "/api/ekoteologi/cron/backup", { token: adminToken, body: {} })
      check("route backup manual → file .zip dibuat", backup.status === 200 && /^manual_.*\.zip$/.test(backup.data?.file || ""), JSON.stringify(backup.data))
      const backupsList = await api("GET", "/api/backups", { token: suToken })
      check("cadangan terbaca di /api/backups (superuser)", (backupsList.data || []).some((b) => b.key === backup.data?.file), JSON.stringify(backupsList.data))
      const backupUser = await api("POST", "/api/ekoteologi/cron/backup", { token: aToken, body: {} })
      check("backup hanya utk admin", backupUser.status === 401 || backupUser.status === 403)

      // guard update notifications: hanya read_at
      const ownNotif = await api("GET", "/api/collections/notifications/records?filter=" + encodeURIComponent('title = "Poin misi masuk"'), { token: aToken })
      const notifId = ownNotif.data?.items?.[0]?.id
      const markRead = await api("PATCH", `/api/collections/notifications/records/${notifId}`, { token: aToken, body: { read_at: new Date().toISOString() } })
      check("pemilik menandai notifikasi dibaca (read_at)", markRead.status === 200 && !!markRead.data?.read_at)
      const deface = await api("PATCH", `/api/collections/notifications/records/${notifId}`, { token: aToken, body: { title: "judul palsu" } })
      check("pemilik TIDAK bisa mengubah judul/isi notifikasi (403)", deface.status === 403, `status ${deface.status}`)
    }

    // ── 15. instance fault-injection: rollback review atomik + Sentry + fallback log ──
    console.log("[15] Sprint 13: rollback review full-atomik (ledger dimatikan) + Sentry + fallback push log")
    {
      // salinan hook + satu file fault: ledger create selalu gagal.
      const faultDir = mkdtempSync(path.join(os.tmpdir(), "pb-fault-"))
      const faultData = path.join(faultDir, "pb_data")
      const faultHooks = path.join(faultDir, "pb_hooks")
      const fsProm = await import("node:fs")
      fsProm.cpSync(HOOKS, faultHooks, { recursive: true })
      writeFileSync(
        path.join(faultHooks, "zz_fault.pb.js"),
        'onRecordCreate((e) => { throw new BadRequestError("fault: ledger dimatikan utk uji rollback") }, "point_transactions")\n' +
        'routerAdd("GET", "/api/ekoteologi/fault-500", (e) => { throw new Error("fault: error uji 500 untuk Sentry") })\n'
      )
      const faultPort = await freePort(18600)
      const up2 = spawnSync(PB_BIN, ["superuser", "upsert", SUPERUSER_EMAIL, SUPERUSER_PASSWORD, "--dir", faultData], { stdio: "ignore" })
      if (up2.status !== 0) throw new Error("superuser upsert (instance fault) gagal")
      let faultSrv = spawn(
        PB_BIN,
        ["serve", "--dir", faultData, "--migrationsDir", MIGRATIONS, "--hooksDir", faultHooks, "--http", `127.0.0.1:${faultPort}`],
        {
          stdio: ["ignore", "pipe", "pipe"],
          // PUSH_MODE=fcm TANPA FCM_PROJECT_ID → fallback log; SENTRY_DSN → mock store.
          env: { ...process.env, PUSH_MODE: "fcm", SENTRY_DSN: `http://testkey@127.0.0.1:${MOCK_PORT}/1` },
        }
      )
      const fBase = `http://127.0.0.1:${faultPort}`
      faultSrv.stderr.on("data", (d) => process.env.PB_TEST_VERBOSE && process.stderr.write("[fault] " + d))
      faultSrv.stdout.on("data", (d) => process.env.PB_TEST_VERBOSE && process.stdout.write("[fault] " + d))
      const fauth = async (collection, identity, password) => {
        const res = await fetch(`${fBase}/api/collections/${collection}/auth-with-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identity, password }),
        })
        const data = await res.json().catch(() => null)
        if (res.status !== 200) throw new Error(`auth ${collection} (instance fault) gagal (${res.status})`)
        return data.token
      }
      const fapi = async (method, urlPath, { token, body } = {}) => {
        const res = await fetch(`${fBase}${urlPath}`, {
          method,
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        let data = null
        try {
          data = await res.json()
        } catch {}
        return { status: res.status, data }
      }
      let fReady = false
      for (let i = 0; i < 60; i++) {
        try {
          const { status } = await fapi("GET", "/api/health")
          if (status === 200) {
            fReady = true
            break
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 500))
      }
      check("instance fault-injection menyala", fReady)
      if (fReady) {
        const suT = await fauth("_superusers", SUPERUSER_EMAIL, SUPERUSER_PASSWORD)
        const okH = await fapi("POST", "/api/collections/users/records", { body: { email: "hana@ekoteologi.id", password: "RahasiaKu123", passwordConfirm: "RahasiaKu123", full_name: "Hana Uji" } })
        check("registrasi user H (instance fault)", okH.status === 200, JSON.stringify(okH.data))
        const hId = okH.data?.id
        const hToken = await fauth("users", "hana@ekoteologi.id", "RahasiaKu123")
        const okAdmin = await fapi("POST", "/api/collections/users/records", { body: { email: "boss@ekoteologi.id", password: "RahasiaKu123", passwordConfirm: "RahasiaKu123", full_name: "Boss Uji" } })
        await fapi("PATCH", `/api/collections/users/records/${okAdmin.data?.id}`, { token: suT, body: { role: "admin" } })
        const adminT = await fauth("users", "boss@ekoteologi.id", "RahasiaKu123")
        const mFault = await fapi("POST", "/api/collections/missions/records", { token: suT, body: { title: "Misi Fault", points: 9, verification: "photo", is_active: true } })
        const PNG_1PX = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          "base64"
        )
        const claimFault = async () => {
          const form = new FormData()
          form.append("consent", "1")
          form.append("proof", new Blob([PNG_1PX], { type: "image/png" }), "bukti.png")
          return fetch(`${fBase}/api/ekoteologi/missions/${mFault.data?.id}/claim`, {
            method: "POST",
            headers: { Authorization: hToken },
            body: form,
          }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
        }
        const claim1 = await claimFault()
        check("fault: klaim photo → submitted", claim1.status === 200 && claim1.data?.claim?.status === "submitted", JSON.stringify(claim1.data))
        const approve = await fapi("PATCH", `/api/collections/user_missions/records/${claim1.data?.claim?.id}`, { token: adminT, body: { status: "approved" } })
        check("fault: approve gagal 500 (ledger error tertangkap jadi pesan ramah)", approve.status === 500, `status ${approve.status} ${JSON.stringify(approve.data)}`)
        const claimAfter = await fapi("GET", `/api/collections/user_missions/records/${claim1.data?.claim?.id}`, { token: suT })
        check(
          "ROLLBACK atomik: klaim tetap submitted, poin & reviewer kosong",
          claimAfter.data?.status === "submitted" && (claimAfter.data?.points_awarded || 0) === 0 && !claimAfter.data?.reviewed_at,
          JSON.stringify(claimAfter.data)
        )
        const hAfter = await fapi("GET", `/api/collections/users/records/${hId}`, { token: hToken })
        check("ROLLBACK: users.points tidak berubah (0)", (hAfter.data?.points || 0) === 0)
        const hNotif = await fapi("GET", "/api/collections/notifications/records", { token: hToken })
        check("ROLLBACK: tidak ada notif 'Misi disetujui!' hantu", !(hNotif.data?.items || []).some((n) => n.title === "Misi disetujui!"))
        const ledgerGhost = await fapi("GET", "/api/collections/point_transactions/records", { token: suT })
        check("ROLLBACK: tidak ada baris ledger hantu", (ledgerGhost.data?.totalItems || 0) === 0)
        const faultRoute = await fetch(`${fBase}/api/ekoteologi/fault-500`)
        check("route fault (error mentah) → ditanggi PB (400) tapi lolos middleware", faultRoute.status === 400, `status ${faultRoute.status}`)
        await new Promise((r) => setTimeout(r, 900))
        check(
          "error 500 route terkirim ke Sentry mock (middleware error hook)",
          mockState.sentry.length >= 1 && mockState.sentry.some((ev) => /fault: error uji 500/.test(ev?.message || "")),
          JSON.stringify(mockState.sentry)
        )
        // fallback push log: reject (tanpa ledger) → notif + push mode log
        const reject = await fapi("PATCH", `/api/collections/user_missions/records/${claim1.data?.claim?.id}`, { token: adminT, body: { status: "rejected", review_note: "Foto kurang jelas" } })
        check("fault: reject tetap jalan (tanpa ledger)", reject.status === 200 && reject.data?.status === "rejected", JSON.stringify(reject.data))
        const hNotif2 = await fapi("GET", "/api/collections/notifications/records", { token: hToken })
        const rejectNotif = (hNotif2.data?.items || []).find((n) => n.title === "Misi perlu diperbaiki")
        check(
          "PUSH_MODE=fcm tanpa FCM_PROJECT_ID → fallback mode=log (wajib teruji)",
          !!rejectNotif && rejectNotif?.payload?.push?.mode === "log" && rejectNotif?.payload?.push?.recipients === 1,
          JSON.stringify(rejectNotif?.payload)
        )
      }
      faultSrv.kill("SIGTERM")
      rmSync(faultDir, { recursive: true, force: true })
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
