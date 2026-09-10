#!/usr/bin/env node
/**
 * Sprint 9 — verifikasi fondasi PocketBase (pengganti pytest api).
 *
 * Boot instance uji sekali pakai (pb_data sementara), lalu asersi via HTTP:
 *   1. /api/health + route kustom /api/ekoteologi/ping
 *   2. Migrasi skema: seluruh koleksi ter-port ada; `users` auth collection
 *   3. Seed awal: 7 kategori sampah, 10 levels, 10 badges
 *   4. API rules: default deny, ownership, role admin/verifier, anti dobel klaim
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
    { stdio: ["ignore", "pipe", "pipe"] }
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
    const suToken = await auth("_superusers", SUPERUSER_EMAIL, SUPERUSER_PASSWORD)
    {
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
    let adminToken, aToken, bToken, aId, bId, missionId
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

      // ownership scans
      const anonScan = await api("POST", "/api/collections/scans/records", { body: { user: aId, item_name: "botol" } })
      check("anonim tidak bisa create scans", anonScan.status >= 400)
      const ownScan = await api("POST", "/api/collections/scans/records", { token: aToken, body: { user: aId, item_name: "botol plastik" } })
      check("user create scans miliknya → 200", ownScan.status === 200, JSON.stringify(ownScan.data))
      const foreign = await api("POST", "/api/collections/scans/records", { token: aToken, body: { user: bId, item_name: "bukan milikmu" } })
      check("create scans atas nama user lain ditolak", foreign.status >= 400)
      const listA = await api("GET", "/api/collections/scans/records", { token: aToken })
      const listB = await api("GET", "/api/collections/scans/records", { token: bToken })
      check("list scans hanya milik sendiri", listA.data?.totalItems === 1 && listB.data?.totalItems === 0)
      const detailB = await api("GET", `/api/collections/scans/records/${ownScan.data?.id}`, { token: bToken })
      check("view scans milik orang lain → 404", detailB.status === 404)

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

      // klaim misi + anti dobel periode
      const period = "2026-09-10 00:00:00.000Z"
      const claim = await api("POST", "/api/collections/user_missions/records", {
        token: aToken,
        body: { user: aId, mission: missionId, period_date: period },
      })
      check("klaim misi pertama → 200", claim.status === 200, JSON.stringify(claim.data))
      const dup = await api("POST", "/api/collections/user_missions/records", {
        token: aToken,
        body: { user: aId, mission: missionId, period_date: period },
      })
      check("anti dobel klaim periode sama ditolak (unique index)", dup.status >= 400)
      const verifList = await api("GET", "/api/collections/user_missions/records", { token: bToken })
      check("verifier melihat antrian klaim user", verifList.status === 200 && verifList.data?.totalItems === 1)
      const review = await api("PATCH", `/api/collections/user_missions/records/${claim.data?.id}`, {
        token: bToken,
        body: { status: "approved", points_awarded: 10, reviewed_by: bId, reviewed_at: new Date().toISOString() },
      })
      check("verifier approve klaim", review.status === 200, JSON.stringify(review.data))

      // ledger ditulis sistem; user hanya baca miliknya
      const ledger = await api("POST", "/api/collections/point_transactions/records", {
        token: suToken,
        body: { user: aId, amount: 10, source: "mission", ref_id: claim.data?.id, note: "approve misi uji" },
      })
      check("ledger ditulis konteks sistem", ledger.status === 200)
      const ledgerA = await api("GET", "/api/collections/point_transactions/records", { token: aToken })
      const ledgerB = await api("GET", "/api/collections/point_transactions/records", { token: bToken })
      check("ledger: A lihat miliknya, B tidak", ledgerA.data?.totalItems === 1 && ledgerB.data?.totalItems === 0)
      const ledgerWrite = await api("POST", "/api/collections/point_transactions/records", { token: aToken, body: { user: aId, amount: 100, source: "scan" } })
      check("user tidak bisa menulis ledger sendiri (append-only)", ledgerWrite.status >= 400)

      // notifikasi: milik + broadcast terlihat; create terkunci
      const bc = await api("POST", "/api/collections/notifications/records", {
        token: suToken,
        body: { title: "Broadcast uji", body: "halo semua", type: "info" },
      })
      check("superuser buat broadcast (user kosong)", bc.status === 200)
      const notifA = await api("GET", "/api/collections/notifications/records", { token: aToken })
      check("user melihat broadcast", notifA.status === 200 && notifA.data?.totalItems === 1)
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
