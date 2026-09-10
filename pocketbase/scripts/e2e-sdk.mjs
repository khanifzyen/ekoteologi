#!/usr/bin/env node
/**
 * Sprint 10 — E2E alur klien (SDK `pocketbase`) terhadap instance uji.
 *
 * Mensimulasikan persis jalur yang dipakai admin & mobile setelah swap SDK:
 *   1. Registrasi publik → authWithPassword → authStore valid (token persist).
 *   2. authRefresh (pemulihan sesi + refresh otomatis).
 *   3. PATCH profil (nama, kota) + unggah avatar (field file) + getURL → 200.
 *   4. Profil gabungan: levels (posisi level), hitungan scans/klaim/badge.
 *   5. Misi: list misi aktif (publik), klaim manual (user_missions submit).
 *   6. Verifikasi admin: antrian `submitted` (rule staff) → approve.
 *   7. Audit log terisi (admin baca), notifikasi broadcast terbaca user.
 *   8. Logout → authStore bersih.
 *
 * Jalankan: node pocketbase/scripts/e2e-sdk.mjs   (butuh binary — make pb-install)
 * SDK diimpor dari admin/node_modules (dependensi workspace sudah ada).
 */
import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'

// SDK diimpor dari dependensi workspace yang sudah ada (admin → mobile →
// resolusi standar). Job CI backend menjalankan `npm ci` admin sebelum step ini.
const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
function loadPocketBase() {
  for (const base of ['../../admin', '../../mobile', '..']) {
    try {
      return require(path.resolve(HERE, base, 'node_modules/pocketbase')).default
    } catch {
      /* coba lokasi berikutnya */
    }
  }
  return require('pocketbase').default
}
const PocketBase = loadPocketBase()

const DIR = HERE
const PB_DIR = path.resolve(DIR, '..')
const PB_BIN = process.env.PB_BIN || path.join(PB_DIR, 'pocketbase')
const PORT = Number(process.env.PB_E2E_PORT || 19090 + (process.pid % 400))
const SUPERUSER_EMAIL = 'admin@ekoteologi.id'
const SUPERUSER_PASSWORD = 'ekoteologi123'

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function freePort(preferred) {
  for (let p = preferred; p < preferred + 50; p++) {
    const free = await new Promise((resolve) => {
      const srv = net.createServer()
      srv.once('error', () => resolve(false))
      srv.once('listening', () => srv.close(() => resolve(true)))
      srv.listen(p, '127.0.0.1')
    })
    if (free) return p
  }
  throw new Error('tidak ada port bebas')
}

const tmpData = path.join(os.tmpdir(), `pb-e2e-${process.pid}-${Date.now()}`)
let server = null
let BASE = ''

async function startServer() {
  rmSync(tmpData, { recursive: true, force: true })
  const port = await freePort(PORT)
  BASE = `http://127.0.0.1:${port}`
  const up = spawnSync(PB_BIN, ['superuser', 'upsert', SUPERUSER_EMAIL, SUPERUSER_PASSWORD, '--dir', tmpData], { stdio: 'ignore' })
  if (up.status !== 0) throw new Error('superuser upsert gagal')
  server = spawn(
    PB_BIN,
    ['serve', '--dir', tmpData, '--migrationsDir', path.join(PB_DIR, 'pb_migrations'), '--hooksDir', path.join(PB_DIR, 'pb_hooks'), '--http', `127.0.0.1:${port}`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  server.stderr.on('data', (d) => process.env.PB_TEST_VERBOSE && process.stderr.write(d))
  const pb = new PocketBase(BASE)
  for (let i = 0; i < 60; i++) {
    try {
      await pb.collection('_').client.send('/api/health', { method: 'GET' })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error('instance uji tidak kunjung siap')
}

function stopServer() {
  if (server) server.kill('SIGTERM')
  rmSync(tmpData, { recursive: true, force: true })
}

// Avatar PNG 1x1 valid (bukan teks) agar lolos validasi mime server.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function main() {
  await startServer()
  const pb = new PocketBase(BASE)
  try {
    // ── 1. registrasi + login (alur AuthView) ──
    console.log('[1] Register + authWithPassword (SDK)')
    await pb.collection('users').create({
      email: 'siti@ekoteologi.id',
      password: 'RahasiaKu123',
      passwordConfirm: 'RahasiaKu123',
      full_name: 'Siti Aminah',
    })
    await pb.collection('users').authWithPassword('siti@ekoteologi.id', 'RahasiaKu123')
    check('authStore valid setelah login', pb.authStore.isValid)
    check('role default user', pb.authStore.record?.role === 'user')
    check('token persist (bisa disimpan)', typeof pb.authStore.token === 'string' && pb.authStore.token.split('.').length === 3)

    // ── 2. pemulihan sesi + refresh otomatis (instance baru, kaki authStore) ──
    console.log('[2] authRefresh (pemulihan sesi)')
    const pb2 = new PocketBase(BASE)
    pb2.authStore.save(pb.authStore.token, pb.authStore.record)
    await pb2.collection('users').authRefresh()
    check('sesi dipulihkan via authRefresh', pb2.authStore.isValid && pb2.authStore.record?.id === pb.authStore.record?.id)

    // ── 3. profil: nama/kota + avatar upload + file URL ──
    console.log('[3] Profil: PATCH + upload avatar')
    const uid = pb.authStore.record?.id
    const updated = await pb.collection('users').update(uid, { full_name: 'Siti Aminah', city: 'Bandung' })
    check('update nama & kota', updated.city === 'Bandung')
    const form = new FormData()
    form.append('avatar', new Blob([PNG_1PX], { type: 'image/png' }), 'avatar.png')
    const withAvatar = await pb.collection('users').update(uid, form)
    check('avatar terunggah (field file)', typeof withAvatar.avatar === 'string' && withAvatar.avatar.length > 0)
    const avatarUrl = pb.files.getURL(withAvatar, withAvatar.avatar)
    const avatarResp = await fetch(avatarUrl)
    check('file URL avatar bisa diakses (getURL → 200)', avatarResp.status === 200)

    // ── 4. profil gabungan: level ladder + hitungan ──
    console.log('[4] Profil gabungan (levels + hitungan koleksi)')
    const levels = await pb.collection('levels').getFullList({ sort: 'level' })
    check('tangga 10 level terbaca (publik)', levels.length === 10 && levels[0].level === 1)
    const scans = await pb.collection('scans').getList(1, 1, { filter: `user = "${uid}"`, fields: 'id' })
    check('hitungan scan milik sendiri = 0', scans.totalItems === 0)

    // ── 5. misi: list publik + klaim manual ──
    console.log('[5] Misi: klaim manual via user_missions')
    const su = new PocketBase(BASE)
    await su.collection('_superusers').authWithPassword(SUPERUSER_EMAIL, SUPERUSER_PASSWORD)
    const mission = await su.collection('missions').create({
      title: 'Misi E2E',
      points: 15,
      verification: 'manual',
      is_active: true,
      type: 'daily',
      required_count: 1,
    })
    const activeMissions = await pb.collection('missions').getFullList({ filter: 'is_active = true' })
    check('misi aktif terbaca publik', activeMissions.length === 1)
    const period = `${new Date().toISOString().slice(0, 10)} 00:00:00.000Z`
    await pb.collection('user_missions').create({
      user: uid,
      mission: mission.id,
      period_date: period,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
    try {
      await pb.collection('user_missions').create({
        user: uid,
        mission: mission.id,
        period_date: period,
        status: 'submitted',
      })
      check('anti dobel klaim ditolak', false)
    } catch (err) {
      check('anti dobel klaim ditolak', err?.status === 400)
    }
    const myClaims = await pb.collection('user_missions').getFullList({ filter: `user = "${uid}"` })
    check('klaim saya terbaca (status submitted)', myClaims.length === 1 && myClaims[0].status === 'submitted')

    // ── 6. verifikasi admin (antrian + approve) ──
    // Panel admin login sebagai user ber-role staff (bukan superuser) —
    // reviewed_by adalah relasi ke koleksi `users`.
    console.log('[6] Verifikasi admin (rule staff)')
    const verifier = new PocketBase(BASE)
    const verifierRecord = await verifier.collection('users').create({
      email: 'verifier@ekoteologi.id',
      password: 'RahasiaKu123',
      passwordConfirm: 'RahasiaKu123',
      full_name: 'Vira Verifier',
    })
    // Registrasi publik memaksa role "user" (anti eskalasi) — superuser yang
    // mempromosikan ke verifier (jalur kelola pengguna di panel).
    await su.collection('users').update(verifierRecord.id, { role: 'verifier' })
    await verifier.collection('users').authWithPassword('verifier@ekoteologi.id', 'RahasiaKu123')
    check('verifier dipromosikan & masuk', verifier.authStore.record?.role === 'verifier')
    const queue = await verifier.collection('user_missions').getFullList({
      filter: 'status = "submitted"',
      expand: 'user,mission',
    })
    check('antrian staff terbaca dgn expand', queue.length === 1 && queue[0].expand?.user?.full_name === 'Siti Aminah')
    await verifier.collection('user_missions').update(queue[0].id, {
      status: 'approved',
      reviewed_by: verifier.authStore.record?.id,
      reviewed_at: new Date().toISOString(),
      points_awarded: 15,
    })
    const approvedCount = await verifier.collection('user_missions').getList(1, 1, {
      filter: `user = "${uid}" && status = "approved"`,
      fields: 'id',
    })
    check('approve tersimpan (status approved)', approvedCount.totalItems === 1)

    // ── 7. audit log + broadcast ──
    console.log('[7] Audit log & notifikasi')
    const audit = await su.collection('audit_logs').getList(1, 5, { filter: "action = 'login' && entity = 'users'" })
    check('login ter-audit', audit.totalItems >= 1)
    const auditUser = await pb.collection('audit_logs').getList(1, 1)
    check('user biasa ditolak baca audit', auditUser.totalItems === 0)
    await su.collection('notifications').create({ title: 'Halo', body: 'broadcast E2E', type: 'info' })
    const notifs = await pb.collection('notifications').getFullList()
    check('broadcast terbaca user', notifs.length === 1)

    // ── 8. scan AI via route kustom (jalur persis mobile — Sprint 11) ──
    console.log('[8] Scan AI: pb.send multipart → hasil + poin + cache + riwayat')
    const scanPost = (buffer, filename) => {
      const form = new FormData()
      form.append('image', new Blob([buffer], { type: 'image/png' }), filename)
      return pb.send('/api/ekoteologi/scan', { method: 'POST', body: form, requestKey: null })
    }
    const PNG_1PX_SCAN = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    const scan1 = await scanPost(PNG_1PX_SCAN, 'scan.png')
    check(
      'scan 1 → kontrak hasil lengkap (item, kategori, saran, quote, poin)',
      typeof scan1?.id === 'string' &&
        typeof scan1?.item_name === 'string' &&
        !!scan1?.category?.name &&
        typeof scan1?.advice === 'string' &&
        typeof scan1?.quote?.text === 'string' &&
        scan1?.points > 0 &&
        scan1?.points_total === scan1?.points &&
        scan1?.cached === false &&
        scan1?.duplicate === false,
      JSON.stringify(scan1),
    )
    await pb.collection('users').authRefresh()
    check('poin tersinkron ke users.points (ledger hook, authRefresh)', pb.authStore.record?.points === scan1.points_total, `authStore.points=${pb.authStore.record?.points}`)
    const scan2 = await scanPost(PNG_1PX_SCAN, 'scan.png')
    check(
      'scan 2 (foto sama) → cache + duplikat, poin 0',
      scan2?.cached === true && scan2?.duplicate === true && scan2?.points === 0 && scan2?.points_total === scan1.points_total,
      JSON.stringify(scan2),
    )
    const history = await pb.collection('scans').getList(1, 10, {
      filter: `user = "${uid}"`,
      sort: '-created',
      expand: 'category',
    })
    check(
      'riwayat scan terisi dgn expand kategori',
      history.totalItems === 2 && !!history.items[0].item_name && history.items[0].expand?.category?.name === scan1.category?.name,
      `total=${history.totalItems}`,
    )
    const cats = await pb.collection('waste_categories').getFullList({ sort: 'name' })
    check('kategori utk filter riwayat terbaca (7 seed)', cats.length === 7)
    const quota = await pb.send('/api/ekoteologi/scan/quota', { method: 'GET' })
    check('kuota via route: used=2 limit=20', quota?.used === 2 && quota?.limit === 20 && quota?.remaining === 18, JSON.stringify(quota))
    const stats = await pb.send('/api/ekoteologi/scan/stats', { method: 'GET' })
    check('stats cache: hit≥1 & mode mock', stats?.hit >= 1 && stats?.llm_mode === 'mock', JSON.stringify(stats))

    // ── 9. logout ──
    console.log('[9] Logout')
    pb.authStore.clear()
    check('authStore bersih setelah logout', !pb.authStore.isValid && pb.authStore.token === '')
  } finally {
    stopServer()
    console.log(`\nHasil E2E SDK: ${passed} PASS, ${failed} FAIL`)
    process.exitCode = failed === 0 ? 0 : 1
  }
}

main().catch((err) => {
  console.error('FATAL:', err?.message || err)
  stopServer()
  process.exit(1)
})
