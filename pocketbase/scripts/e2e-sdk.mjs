#!/usr/bin/env node
/**
 * Sprint 10 — E2E alur klien (SDK `pocketbase`) terhadap instance uji.
 * Sprint 12 — misi: klaim manual/photo via route hook (auto-approve, anti
 * dobel, consent), verifikasi admin → poin ledger + notifikasi, badge lazy,
 * streak (status + kalender), level engine di users.
 * Sprint 13 — e-learning via route (kuis server-side + anti dobel poin),
 * realtime SSE notifikasi, broadcast composer, konten harian, dashboard.
 *
 * Mensimulasikan persis jalur yang dipakai admin & mobile setelah swap SDK:
 *   1. Registrasi publik → authWithPassword → authStore valid (token persist).
 *   2. authRefresh (pemulihan sesi + refresh otomatis).
 *   3. PATCH profil (nama, kota) + unggah avatar (field file) + getURL → 200.
 *   4. Profil gabungan: levels (posisi level), hitungan scans/klaim/badge.
 *   5. Misi: klaim manual via route → auto-approve + poin + level; anti dobel.
 *   6. Verifikasi admin: klaim photo → antrian → approve → ledger+notif+badge.
 *   7. Audit log terisi (admin baca), notifikasi broadcast terbaca user.
 *   8. Logout → authStore bersih.
 *   9. E-learning via route hook (sprint 13).
 *  10. Realtime SSE + broadcast + daily-content + dashboard (sprint 13).
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

// Node tidak menyertakan EventSource global (browser/mobile WebView iya) —
// polyfill SSE minimal berbasis fetch agar uji realtime SDK bisa jalan di CI.
// Mendukung kontrak yang dipakai SDK pocketbase: onopen/onmessage/onerror,
// addEventListener utk event bernama (PB_CONNECT dgn lastEventId), dan close().
if (typeof globalThis.EventSource === 'undefined') {
  globalThis.EventSource = class {
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.lastEventId = ''
      this.onopen = null
      this.onmessage = null
      this.onerror = null
      this._listeners = {}
      this._ctrl = new AbortController()
      this._closed = false
      fetch(url, { signal: this._ctrl.signal, headers: { Accept: 'text/event-stream' } })
        .then(async (res) => {
          if (!res.ok || !res.body) throw new Error('SSE HTTP ' + res.status)
          this.readyState = 1
          if (this.onopen) this.onopen()
          const reader = res.body.getReader()
          const dec = new TextDecoder()
          let buf = ''
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buf += dec.decode(value, { stream: true })
            let idx
            while ((idx = buf.indexOf('\n\n')) !== -1) {
              const chunk = buf.slice(0, idx)
              buf = buf.slice(idx + 2)
              let data = ''
              let name = ''
              let id = ''
              for (const line of chunk.split('\n')) {
                if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trimStart()
                else if (line.startsWith('event:')) name = line.slice(6).trim()
                else if (line.startsWith('id:')) id = line.slice(3).trim()
              }
              if (!data && !name) continue
              if (id) this.lastEventId = id
              const payload = { data, lastEventId: this.lastEventId }
              if (name) {
                for (const cb of this._listeners[name] || []) cb(payload)
              } else if (this.onmessage) {
                this.onmessage(payload)
              }
            }
          }
        })
        .catch((err) => {
          if (!this._closed && this.onerror) this.onerror(err)
        })
    }
    addEventListener(type, cb) {
      ;(this._listeners[type] = this._listeners[type] || []).push(cb)
    }
    removeEventListener(type, cb) {
      this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== cb)
    }
    close() {
      this._closed = true
      this.readyState = 2
      this._ctrl.abort()
    }
  }
}

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

    // ── 5. misi: klaim manual via route (auto-approve + poin) ──
    console.log('[5] Misi: klaim manual via route hook (sprint 12)')
    const su = new PocketBase(BASE)
    await su.collection('_superusers').authWithPassword(SUPERUSER_EMAIL, SUPERUSER_PASSWORD)
    const mission = await su.collection('missions').create({
      title: 'Misi E2E Manual',
      points: 15,
      verification: 'manual',
      is_active: true,
      type: 'daily',
      required_count: 1,
    })
    const photoMission = await su.collection('missions').create({
      title: 'Misi E2E Foto',
      points: 8,
      verification: 'photo',
      is_active: true,
      type: 'daily',
      required_count: 1,
    })
    const activeMissions = await pb.collection('missions').getFullList({ filter: 'is_active = true' })
    check('misi aktif terbaca publik', activeMissions.length === 2)
    const manualClaim = await pb.send(`/api/ekoteologi/missions/${mission.id}/claim`, {
      method: 'POST',
      body: {},
      requestKey: null,
    })
    check(
      'klaim manual → auto-approve + pesan poin',
      manualClaim?.claim?.status === 'approved' && manualClaim?.claim?.points_awarded === 15 && /15 poin/.test(manualClaim?.message || ''),
      JSON.stringify(manualClaim),
    )
    await pb.collection('users').authRefresh()
    check('poin klaim manual tersinkron (users.points, authRefresh)', pb.authStore.record?.points === 15, `points=${pb.authStore.record?.points}`)
    check('level terisi engine (15 poin → level 1)', pb.authStore.record?.level === 1 && !!pb.authStore.record?.level_title, JSON.stringify({ level: pb.authStore.record?.level, title: pb.authStore.record?.level_title }))
    let dupErr = null
    try {
      await pb.send(`/api/ekoteologi/missions/${mission.id}/claim`, { method: 'POST', body: {}, requestKey: null })
    } catch (err) {
      dupErr = err
    }
    check('anti dobel klaim → 409 ramah', dupErr?.status === 409 && /(klaim|selesai)/i.test(dupErr?.response?.message || ''), JSON.stringify(dupErr?.response?.message))

    // ── 6. verifikasi admin (klaim photo → antrian → approve → ledger+notif) ──
    console.log('[6] Verifikasi admin (rule staff) + efek engine sprint 12')
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
    const proofForm = new FormData()
    proofForm.append('consent', '1')
    proofForm.append('proof', new Blob([PNG_1PX], { type: 'image/png' }), 'bukti.png')
    const photoClaim = await pb.send(`/api/ekoteologi/missions/${photoMission.id}/claim`, {
      method: 'POST',
      body: proofForm,
      requestKey: null,
    })
    check('klaim photo → submitted (consent tercatat server)', photoClaim?.claim?.status === 'submitted', JSON.stringify(photoClaim))
    const photoClaimId = photoClaim?.claim?.id
    let dupPhotoErr = null
    try {
      const f2 = new FormData()
      f2.append('consent', '1')
      f2.append('proof', new Blob([PNG_1PX], { type: 'image/png' }), 'bukti.png')
      await pb.send(`/api/ekoteologi/missions/${photoMission.id}/claim`, { method: 'POST', body: f2, requestKey: null })
    } catch (err) {
      dupPhotoErr = err
    }
    check('anti dobel klaim photo → 409', dupPhotoErr?.status === 409, JSON.stringify(dupPhotoErr?.response?.message))
    const queue = await verifier.collection('user_missions').getFullList({
      filter: 'status = "submitted"',
      expand: 'user,mission',
    })
    check(
      'antrian staff terbaca dgn expand + bukti',
      queue.length === 1 && queue[0].expand?.user?.full_name === 'Siti Aminah' && typeof queue[0].proof === 'string' && queue[0].proof.length > 0,
      JSON.stringify(queue.length),
    )
    let rejectNoNoteErr = null
    try {
      await verifier.collection('user_missions').update(photoClaimId, { status: 'rejected' })
    } catch (err) {
      rejectNoNoteErr = err
    }
    check('tolak tanpa catatan ditolak server (400)', rejectNoNoteErr?.status === 400, `status ${rejectNoNoteErr?.status}`)
    await verifier.collection('user_missions').update(photoClaimId, {
      status: 'approved',
    })
    const approvedClaim = await verifier.collection('user_missions').getOne(photoClaimId)
    check('approve tersimpan + poin dipaksa server (8)', approvedClaim.status === 'approved' && approvedClaim.points_awarded === 8 && approvedClaim.reviewed_by === verifier.authStore.record?.id, JSON.stringify({ status: approvedClaim.status, points: approvedClaim.points_awarded }))
    await pb.collection('users').authRefresh()
    check('poin approve tersinkron (15+8=23, authRefresh)', pb.authStore.record?.points === 23, `points=${pb.authStore.record?.points}`)
    const myNotifs = await pb.collection('notifications').getFullList()
    check('notif "Misi disetujui!" diterima user', myNotifs.some((n) => n.title === 'Misi disetujui!'), JSON.stringify(myNotifs.map((n) => n.title)))
    const myBadges = await pb.send('/api/ekoteologi/badges', { method: 'GET', requestKey: null })
    check('badge misi_pertama diraih otomatis', Array.isArray(myBadges) && myBadges.find((b) => b.code === 'misi_pertama')?.earned === true, JSON.stringify(Array.isArray(myBadges) ? myBadges.filter((b) => b.earned).map((b) => b.code) : myBadges))
    const streak = await pb.send('/api/ekoteologi/streak', { method: 'GET', requestKey: null })
    check(
      'streak hidup: aktif hari ini + kalender 7 hari + konfigurasi bonus',
      streak?.active_today === true && streak?.current_streak >= 1 && streak?.week?.length === 7 && streak?.bonus_every_days === 6,
      JSON.stringify(streak),
    )

    // ── 7. audit log + broadcast ──
    console.log('[7] Audit log & notifikasi')
    const audit = await su.collection('audit_logs').getList(1, 5, { filter: "action = 'login' && entity = 'users'" })
    check('login ter-audit', audit.totalItems >= 1)
    const auditUser = await pb.collection('audit_logs').getList(1, 1)
    check('user biasa ditolak baca audit', auditUser.totalItems === 0)
    await su.collection('notifications').create({ title: 'Halo', body: 'broadcast E2E', type: 'info' })
    const notifs = await pb.collection('notifications').getFullList()
    check('broadcast terbaca user', notifs.some((n) => n.title === 'Halo'), JSON.stringify(notifs.map((n) => n.title)))

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
        scan1?.points_total === 23 + scan1?.points &&
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

    // ── 9. e-learning via route hook (jalur persis layar Belajar — Sprint 13) ──
    console.log('[9] E-learning: modul → pelajaran → kuis server-side (anti dobel poin)')
    const mod = await su.collection('modules').create({
      title: 'Modul E2E Sprint 13',
      slug: 'modul-e2e-13',
      description: 'Modul uji E2E',
      order: 1,
      is_published: true,
    })
    const les1 = await su.collection('lessons').create({
      module: mod.id,
      title: 'Pelajaran Satu',
      order: 0,
      content: [{ type: 'paragraph', text: 'Materi pertama.' }, { type: 'tip', text: 'Tips singkat.' }],
    })
    const les2 = await su.collection('lessons').create({
      module: mod.id,
      title: 'Pelajaran Dua',
      order: 1,
      content: [{ type: 'paragraph', text: 'Materi kedua.' }],
    })
    const quiz = await su.collection('quizzes').create({ module: mod.id })
    const qIds = []
    const qAnswers = [2, 0, 1, 3]
    for (let i = 0; i < 4; i++) {
      const q = await su.collection('quiz_questions').create({
        quiz: quiz.id,
        question: `Soal ${i + 1}?`,
        options: ['A', 'B', 'C', 'D'],
        answer: qAnswers[i],
        explanation: `Penjelasan ${i + 1}.`,
        order: i + 1,
      })
      qIds.push(q.id)
    }
    const listModules = await pb.send('/api/ekoteologi/modules', { method: 'GET', requestKey: null })
    const card = (listModules?.items || []).find((m) => m.id === mod.id)
    check(
      'daftar modul via route: kartu + progres + CTA',
      Array.isArray(listModules?.items) && !!card && card.lesson_count === 2 && card.quiz_question_count === 4 && card.cta === 'Mulai',
      JSON.stringify(card),
    )
    const detailModule = await pb.send(`/api/ekoteologi/modules/${mod.id}`, { method: 'GET', requestKey: null })
    check(
      'detail modul: soal TANPA kunci jawaban (kunci hanya di server)',
      detailModule?.quiz?.questions?.length === 4 && detailModule?.quiz?.questions?.every((q) => !('answer' in q)),
      JSON.stringify(detailModule?.quiz),
    )
    const lockedSoal = await pb.collection('quiz_questions').getFullList({ fields: 'id,answer' })
    check('koleksi quiz_questions terkunci dari klien (0 baris)', lockedSoal.length === 0, `len=${lockedSoal.length}`)
    const lessonDetail = await pb.send(`/api/ekoteologi/lessons/${les1.id}`, { method: 'GET', requestKey: null })
    check(
      'detail pelajaran: blok + next_lesson_id',
      lessonDetail?.blocks?.length === 2 && lessonDetail?.next_lesson_id === les2.id,
      JSON.stringify(lessonDetail),
    )
    const complete1 = await pb.send(`/api/ekoteologi/lessons/${les1.id}/complete`, { method: 'POST', body: {}, requestKey: null })
    const complete2 = await pb.send(`/api/ekoteologi/lessons/${les2.id}/complete`, { method: 'POST', body: {}, requestKey: null })
    check(
      'complete pelajaran berurutan → modul tuntas (sekali)',
      complete1?.lessons_done === 1 && complete1?.just_completed === false && complete2?.lessons_done === 2 && complete2?.just_completed === true,
      JSON.stringify({ complete1, complete2 }),
    )
    const quizIntro = await pb.send(`/api/ekoteologi/modules/${mod.id}/quiz`, { method: 'GET', requestKey: null })
    check('intro kuis: 4 soal + ambang 70 + poin 20', quizIntro?.question_count === 4 && quizIntro?.pass_percent === 70 && quizIntro?.points === 20, JSON.stringify(quizIntro))
    const pointsBefore = pb.authStore.record?.points ?? 0
    const quizPass = await pb.send(`/api/ekoteologi/modules/${mod.id}/quiz`, {
      method: 'POST',
      body: { answers: qAnswers.map((choice, i) => ({ question_id: qIds[i], choice })) },
      requestKey: null,
    })
    check(
      'kuis lulus: poin 20 diputuskan server + points_total terbarui',
      quizPass?.passed === true && quizPass?.points_awarded === 20 && quizPass?.points_total === pointsBefore + 20,
      JSON.stringify(quizPass),
    )
    await pb.collection('users').authRefresh()
    check('poin kuis tersinkron ke users.points (authRefresh)', pb.authStore.record?.points === pointsBefore + 20, `points=${pb.authStore.record?.points}`)
    const quizAgain = await pb.send(`/api/ekoteologi/modules/${mod.id}/quiz`, {
      method: 'POST',
      body: { answers: qAnswers.map((choice, i) => ({ question_id: qIds[i], choice })) },
      requestKey: null,
    })
    check(
      'anti dobel poin: lulus ulang → 0 poin (already_passed_before)',
      quizAgain?.passed === true && quizAgain?.points_awarded === 0 && quizAgain?.already_passed_before === true,
      JSON.stringify(quizAgain),
    )

    // ── 10. notifikasi realtime SSE + broadcast composer + konten harian + dashboard ──
    console.log('[10] Realtime SSE notifikasi + broadcast + daily-content + dashboard')
    const admin13 = new PocketBase(BASE)
    const adminRecord = await admin13.collection('users').create({
      email: 'admin13@ekoteologi.id',
      password: 'RahasiaKu123',
      passwordConfirm: 'RahasiaKu123',
      full_name: 'Aminah Admin',
    })
    await su.collection('users').update(adminRecord.id, { role: 'admin' })
    await admin13.collection('users').authWithPassword('admin13@ekoteologi.id', 'RahasiaKu123')
    check('admin13 (role) masuk', admin13.authStore.record?.role === 'admin')

    const segments = await admin13.send('/api/ekoteologi/admin/push/segments', { method: 'GET', requestKey: null })
    check('preview segmen (admin): 4 segmen', Array.isArray(segments?.items) && segments.items.length === 4, JSON.stringify(segments))

    // realtime: subscribe sebelum broadcast — notifikasi baru tampa polling
    let realtimeHit = null
    const waitForRealtime = new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 10000)
      pb.collection('notifications')
        .subscribe('*', (msg) => {
          clearTimeout(t)
          resolve(msg)
        })
        .then((unsub) => {
          waitForRealtime.unsub = unsub
        })
    })
    await new Promise((r) => setTimeout(r, 800)) // beri waktu SSE tersambung
    const broadcast = await admin13.send('/api/ekoteologi/admin/push/broadcast', {
      method: 'POST',
      body: { title: 'Broadcast Realtime E2E', body: 'Pengumuman langsung ke semua pengguna.', segment: 'all' },
      requestKey: null,
    })
    check(
      'broadcast via route (admin): rekap penerima',
      broadcast?.id && broadcast?.recipients >= 2 && typeof broadcast?.sent === 'number',
      JSON.stringify(broadcast),
    )
    realtimeHit = await waitForRealtime
    check(
      'realtime SSE: notifikasi broadcast diterima TANPA polling',
      !!realtimeHit && realtimeHit?.record?.title === 'Broadcast Realtime E2E',
      JSON.stringify(realtimeHit?.record?.title),
    )
    if (waitForRealtime.unsub) await waitForRealtime.unsub()
    const broadcastUser = await pb.collection('notifications').getFullList({ filter: 'title = "Broadcast Realtime E2E"' })
    check('broadcast terbaca user (in-app)', broadcastUser.length === 1 && broadcastUser[0].payload?.kind === 'broadcast', JSON.stringify(broadcastUser.map((n) => n.title)))

    const daily = await pb.send('/api/ekoteologi/daily-content', { method: 'GET', requestKey: null })
    check(
      'konten harian via route: selalu 200 (fallback bank atau terjadwal)',
      daily && typeof daily.fallback === 'boolean' && !!daily.body && !!daily.source,
      JSON.stringify(daily),
    )
    const dashboard = await verifier.send('/api/ekoteologi/admin/dashboard', { method: 'GET', requestKey: null })
    check(
      'dashboard agregasi via route (staff): KPI + chart',
      dashboard?.users?.total >= 3 && dashboard?.scans && Array.isArray(dashboard?.charts?.daily) && dashboard.charts.daily.length === 14,
      JSON.stringify({ u: dashboard?.users, s: dashboard?.scans }),
    )

    // ── 11. logout ──
    console.log('[11] Logout')
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
