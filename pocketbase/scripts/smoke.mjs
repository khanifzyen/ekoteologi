#!/usr/bin/env node
/**
 * Smoke PocketBase — boot instance sekali pakai (pb_data sementara) lalu cek:
 *   1. GET /api/health            → 200 (endpoint bawaan PB)
 *   2. GET /api/ekoteologi/ping   → 200 (route kustom pb_hooks/main.pb.js)
 * Exit non-zero bila ada yang gagal. Jalankan: make pb-smoke
 */
import { spawn } from "node:child_process"
import { rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import os from "node:os"
import net from "node:net"

const DIR = path.dirname(fileURLToPath(import.meta.url))
const PB_DIR = path.resolve(DIR, "..")
const PB_BIN = process.env.PB_BIN || path.join(PB_DIR, "pocketbase")
const PREFERRED = Number(process.env.PB_SMOKE_PORT || 18190 + (process.pid % 300))

// Port bebas — hindari bentrok dgn instance sisa run lain (sumber flake).
const port = await new Promise(async (resolve) => {
  for (let p = PREFERRED; p < PREFERRED + 50; p++) {
    const free = await new Promise((res) => {
      const srv = net.createServer()
      srv.once("error", () => res(false))
      srv.once("listening", () => srv.close(() => res(true)))
      srv.listen(p, "127.0.0.1")
    })
    if (free) {
      resolve(p)
      return
    }
  }
  throw new Error("tidak ada port bebas")
})
const BASE = `http://127.0.0.1:${port}`
const tmpData = path.join(os.tmpdir(), `pb-smoke-${process.pid}-${Date.now()}`)

const server = spawn(
  PB_BIN,
  [
    "serve",
    "--dir",
    tmpData,
    "--migrationsDir",
    path.join(PB_DIR, "pb_migrations"),
    "--hooksDir",
    path.join(PB_DIR, "pb_hooks"),
    "--http",
    `127.0.0.1:${port}`,
  ],
  { stdio: ["ignore", "ignore", "inherit"] }
)

const stop = () => {
  server.kill("SIGTERM")
  rmSync(tmpData, { recursive: true, force: true })
}
process.on("exit", stop)

let failed = false
try {
  let healthy = false
  for (let i = 0; i < 60 && !healthy; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      healthy = res.status === 200
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  console.log(`${healthy ? "PASS" : "FAIL"} GET /api/health`)
  failed = failed || !healthy

  const ping = await fetch(`${BASE}/api/ekoteologi/ping`)
  const pingOk = ping.status === 200 && !!(await ping.json()).name
  console.log(`${pingOk ? "PASS" : "FAIL"} GET /api/ekoteologi/ping`)
  failed = failed || !pingOk
} catch (err) {
  console.error("FATAL:", err?.message || err)
  failed = true
} finally {
  stop()
}
process.exit(failed ? 1 : 0)
