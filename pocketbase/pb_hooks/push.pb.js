/// <reference path="../pb_data/types.d.ts" />
// Ekoteologi AR — Sprint 13: notifikasi realtime + push FCM (pb_hooks/push.pb.js).
//
// Sumber push = baris `notifications` (keputusan Sprint 5): SETIAP notifikasi
// yang lahir — hasil verifikasi misi, bonus streak, reminder cron, lencana,
// poin kuis — otomatis di-push ke perangkat terkait via hook
// `onRecordAfterCreateSuccess` (terbukti ikut terpanggil utk tulisan internal
// di dalam transaksi hook — teruji sprint 13). Realtime in-app memakai SSE
// bawaan PocketBase (`/api/realtime`, SDK `pocketbase` subscribe di mobile).
//
//   1. Pipeline push — hook create `notifications`:
//        user terisi   → push ke semua token milik user itu
//        user kosong   → broadcast: token sesuai segmen `payload.segment`
//                        (all | aktif_7hari | pasif_7hari | bertoken)
//      Rekap {recipients, tokens, sent, mode} ditulis kembali ke
//      `payload.push` — riwayat komposer cukup dari DB (paritas FastAPI).
//      Push best-effort: gagal push TIDAK pernah menggagalkan notifikasi.
//   2. Pengirim FCM HTTP v1 (`$http.send`) — env PUSH_MODE=log|fcm
//      (default log):
//        log → pesan dicatat di log server (dev/test/fallback aman).
//        fcm → OAuth2 service account: JWT RS256 dibuat MURNI DI JSVM
//              (SHA-256 + RSA PKCS#1 v1.5 via BigInt goja — $security hanya
//              punya HS256/HS512), ditukar access token (di-cache), lalu
//              POST {project}/messages:send. Token 404/410 dari FCM → baris
//              token dihapus (perangkat mati). Tanpa kredensial layak →
//              fallback log + peringatan (fail-safe, kredensial asli item
//              terbuka sejak Sprint 6).
//   3. POST /api/ekoteologi/admin/push/broadcast (role admin) — composer
//      push semua/segmen: SATU baris broadcast `user=""` + push pipeline
//      di atas + audit rekap.
//   4. GET /api/ekoteologi/admin/push/segments (role admin) — rekap
//      penerima/token per segmen (preview komposer).
//   5. Guard update `notifications` — pemilik hanya boleh mengubah
//      `read_at` (tandai dibaca); judul/isi/payload tidak bisa dipalsukan.
//
// Konfigurasi env (lihat .env.example): PUSH_MODE (log|fcm),
// FCM_CREDENTIALS_FILE (path JSON service account) atau FCM_CREDENTIALS_JSON
// (isi JSON langsung), FCM_PROJECT_ID, FCM_OAUTH_URL & FCM_SEND_URL
// (override utk uji — default endpoint Google).
//
// PENTING — batasan JSVM v0.40 (temuan sprint 9–12): seluruh helper DI DALAM
// handler (closure top-level tidak terbawa ke executor pool); duplikasi
// DISENGAJA. `get()` field json → array bita JSON (jsonValue).

// ═══════ 1. Pipeline push: hook create notifications (realtime → device) ═══════

onRecordAfterCreateSuccess((e) => {
  // ── blok bantu: json / waktu / env ──
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

  // ── blok bantu: base64url (encoder JSVM tanpa btoa) ──
  function strBytes(s) {
    const o = []
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      if (c < 128) o.push(c)
      else {
        const enc = unescape(encodeURIComponent(s[i]))
        for (let j = 0; j < enc.length; j++) o.push(enc.charCodeAt(j))
      }
    }
    return o
  }
  const B64A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  function b64ToBytes(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "")
    const out = []
    let buf = 0
    let bits = 0
    for (let i = 0; i < s.length; i++) {
      const v = B64A.indexOf(s[i])
      if (v < 0) continue
      buf = (buf << 6) | v
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out.push((buf >> bits) & 0xff)
      }
    }
    return out
  }
  function bytesToB64url(bytes) {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    let out = ""
    for (let i = 0; i < bytes.length; i += 3) {
      const has2 = i + 1 < bytes.length
      const has3 = i + 2 < bytes.length
      const b1 = bytes[i]
      const b2 = has2 ? bytes[i + 1] : 0
      const b3 = has3 ? bytes[i + 2] : 0
      out += A[b1 >> 2] + A[((b1 & 3) << 4) | (b2 >> 4)]
      if (has2) out += A[((b2 & 15) << 2) | (b3 >> 6)]
      if (has3) out += A[b3 & 63]
    }
    return out
  }

  // ── blok bantu: SHA-256 murni JS (payload JWT kecil — cepat di goja) ──
  function rotr(x, n) {
    return ((x >>> n) | (x << (32 - n))) | 0
  }
  function sha256(msgBytes) {
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]
    let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]
    const len = msgBytes.length
    const p = msgBytes.slice()
    p.push(0x80)
    while (p.length % 64 !== 56) p.push(0)
    const hi = Math.floor(len / 536870912)
    const lo = (len << 3) >>> 0
    p.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255)
    const w = new Array(64)
    for (let off = 0; off < p.length; off += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = ((p[off + i * 4] << 24) | (p[off + i * 4 + 1] << 16) | (p[off + i * 4 + 2] << 8) | p[off + i * 4 + 3]) | 0
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], ee = H[4], f = H[5], g = H[6], h = H[7]
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(ee, 6) ^ rotr(ee, 11) ^ rotr(ee, 25)
        const ch = (ee & f) ^ (~ee & g)
        const t1 = (h + S1 + ch + K[i] + w[i]) | 0
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
        const maj = (a & b) ^ (a & c) ^ (b & c)
        const t2 = (S0 + maj) | 0
        h = g; g = f; f = ee; ee = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0
      H[4] = (H[4] + ee) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0
    }
    const out = []
    for (let i = 0; i < 8; i++) out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255)
    return out
  }

  // ── blok bantu: RSA PKCS#1 v1.5 (RS256) via BigInt goja ──
  function collectInts(der, start, end, outArr) {
    let i = start
    while (i + 1 < end) {
      const tag = der[i]
      i++
      let len = der[i]
      i++
      if (len & 0x80) {
        const n = len & 0x7f
        if (n > 4 || i + n > end) return
        len = 0
        for (let j = 0; j < n; j++) {
          len = len * 256 + der[i]
          i++
        }
      }
      if (i + len > end) return
      if (tag === 0x02) outArr.push(der.slice(i, i + len))
      else if ((tag & 0x20) || tag === 0x04) collectInts(der, i, i + len, outArr)
      i += len
    }
  }
  function bytesToBigint(arr) {
    let v = 0n
    for (let i = 0; i < arr.length; i++) v = (v << 8n) | BigInt(arr[i])
    return v
  }
  function parsePrivateKey(pemStr) {
    const b64 = pemStr.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
    const der = b64ToBytes(b64)
    const ints = []
    collectInts(der, 0, der.length, ints)
    if (ints.length < 9) throw new Error("kunci privat tidak berisi parameter RSA")
    // PKCS#8: [..., version, n, e, d, p, q, dP, dQ, qInv]
    return ints.slice(ints.length - 9).map(function (arr) {
      return bytesToBigint(arr)
    })
  }
  function powMod(b, e, m) {
    let r = 1n
    b %= m
    while (e > 0n) {
      if (e & 1n) r = (r * b) % m
      b = (b * b) % m
      e >>= 1n
    }
    return r
  }
  function signRsaSha256(key, msg) {
    const digest = sha256(msg)
    const prefix = [0x30,0x31,0x30,0x0d,0x06,0x09,0x60,0x86,0x48,0x01,0x65,0x03,0x04,0x02,0x01,0x05,0x00,0x04,0x20]
    const k = (key[1].toString(16).length + 1) >> 1
    const tLen = prefix.length + 32
    const em = new Array(k).fill(0)
    em[0] = 0
    em[1] = 1
    for (let i = 2; i < k - tLen - 1; i++) em[i] = 0xff
    em[k - tLen - 1] = 0
    for (let i = 0; i < prefix.length; i++) em[k - tLen + i] = prefix[i]
    for (let i = 0; i < 32; i++) em[k - 32 + i] = digest[i]
    const m = bytesToBigint(em)
    const p = key[4], q = key[5], dP = key[6], dQ = key[7], qInv = key[8]
    const s1 = powMod(m, dP, p)
    const s2 = powMod(m, dQ, q)
    let h = (s1 - s2) % p
    if (h < 0n) h += p
    h = (h * qInv) % p
    let sig = s2 + q * h
    const out = new Array(k).fill(0)
    for (let i = k - 1; i >= 0; i--) {
      out[i] = Number(sig & 0xffn)
      sig >>= 8n
    }
    return out
  }

  // ── blok bantu: kredensial + OAuth token (cache $app.store + app_settings) ──
  function loadCredentials() {
    let rawJson = ""
    const file = $os.getenv("FCM_CREDENTIALS_FILE")
    if (file) {
      try {
        // Temuan v0.40: $os.readFile mengembalikan ARRAY BITA (bukan string)
        // — normalisasi per-chunk agar aman dari batas apply.
        let content = $os.readFile(file)
        if (content && typeof content === "object" && content.length !== undefined) {
          let out = ""
          for (let i = 0; i < content.length; i += 8192) {
            out += String.fromCharCode.apply(null, content.slice(i, i + 8192))
          }
          content = out
        }
        rawJson = String(content)
      } catch (err) {
        throw new Error("FCM_CREDENTIALS_FILE tidak dapat dibaca: " + err)
      }
    } else {
      rawJson = $os.getenv("FCM_CREDENTIALS_JSON") || ""
    }
    if (!rawJson.trim()) throw new Error("kredensial FCM kosong")
    let data = null
    try {
      data = JSON.parse(rawJson)
    } catch (err) {
      throw new Error("kredensial FCM bukan JSON sah")
    }
    if (!data.client_email || !data.private_key) {
      throw new Error("kredensial FCM tidak lengkap (client_email/private_key)")
    }
    return data
  }
  function jsonBody(res) {
    // Temuan v0.40: res.body bisa array bita (bukan string) — normalisasi.
    let raw = res.body
    if (raw && typeof raw === "object" && raw.length !== undefined) {
      let out = ""
      for (let i = 0; i < raw.length; i += 8192) {
        out += String.fromCharCode.apply(null, raw.slice(i, i + 8192))
      }
      raw = out
    }
    return JSON.parse(String(raw))
  }
  function getAccessToken(app, creds, projectId) {
    // L1: in-memory lintas executor; L2: app_settings (tahan restart).
    const cacheKey = "fcm:tk:" + projectId
    let cached = null
    try {
      cached = app.store().get(cacheKey)
    } catch (err) {
      cached = null
    }
    if (cached && typeof cached === "string") {
      try {
        const v = JSON.parse(cached)
        if (v && v.token && v.expires_at > Date.now() + 60000) return v.token
      } catch (err) {
        cached = null
      }
    }
    try {
      const rec = app.findFirstRecordByFilter("app_settings", "key = {:k}", { k: cacheKey })
      const v = jsonValue(rec.get("value"))
      if (v && v.token && v.expires_at > Date.now() + 60000) {
        try {
          app.store().set(cacheKey, JSON.stringify(v))
        } catch (err) {}
        return v.token
      }
    } catch (err) {
      /* belum ada cache L2 */
    }
    const nowSec = Math.floor(Date.now() / 1000)
    const header = bytesToB64url(strBytes('{"alg":"RS256","typ":"JWT"}'))
    const claims = JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: $os.getenv("FCM_OAUTH_URL") || "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    })
    const signingInput = header + "." + bytesToB64url(strBytes(claims))
    const key = parsePrivateKey(creds.private_key)
    const jwt = signingInput + "." + bytesToB64url(signRsaSha256(key, strBytes(signingInput)))
    const res = $http.send({
      url: $os.getenv("FCM_OAUTH_URL") || "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:
        "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") +
        "&assertion=" + encodeURIComponent(jwt),
      timeout: 15,
    })
    if (res.statusCode >= 400) {
      throw new Error("tukar token OAuth gagal (HTTP " + res.statusCode + ")")
    }
    let tokenData = null
    try {
      tokenData = jsonBody(res)
    } catch (err) {
      throw new Error("respons OAuth tidak dapat dibaca")
    }
    if (!tokenData.access_token) throw new Error("respons OAuth tanpa access_token")
    const entry = {
      token: tokenData.access_token,
      expires_at: Date.now() + (Number(tokenData.expires_in) || 3600) * 1000,
    }
    try {
      app.store().set(cacheKey, JSON.stringify(entry))
    } catch (err) {}
    try {
      let rec = null
      try {
        rec = app.findFirstRecordByFilter("app_settings", "key = {:k}", { k: cacheKey })
      } catch (err) {
        rec = null
      }
      if (!rec) rec = new Record(app.findCollectionByNameOrId("app_settings"))
      rec.set("key", cacheKey)
      rec.set("value", entry)
      app.save(rec)
    } catch (err) {}
    return entry.token
  }

  // ── blok bantu: pengirim (log | fcm) — per token, best-effort ──
  function pushMode(credsOk) {
    const mode = ($os.getenv("PUSH_MODE") || "log").toLowerCase()
    if (mode === "fcm" && credsOk) return "fcm"
    return "log"
  }
  function sendOne(mode, accessToken, projectId, token, title, body, data) {
    if (mode === "log") {
      console.log(
        "PUSH (mode=log) token=" + String(token).slice(0, 12) + "… title='" + title +
          "' body='" + body + "' data=" + JSON.stringify(data)
      )
      return { sent: true, dead: false }
    }
    const dataStr = {}
    const keys = Object.keys(data || {})
    for (let i = 0; i < keys.length; i++) dataStr[keys[i]] = String(data[keys[i]])
    const res = $http.send({
      url:
        ($os.getenv("FCM_SEND_URL") || "https://fcm.googleapis.com/v1") +
        "/projects/" + projectId + "/messages:send",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + accessToken,
      },
      body: JSON.stringify({
        message: {
          token: token,
          notification: { title: title, body: body },
          data: dataStr,
          android: { priority: "HIGH" },
        },
      }),
      timeout: 15,
    })
    if (res.statusCode === 404 || res.statusCode === 410) return { sent: false, dead: true }
    if (res.statusCode >= 400) {
      console.log("PUSH gagal (HTTP " + res.statusCode + ") token=" + String(token).slice(0, 12) + "…")
      return { sent: false, dead: false }
    }
    return { sent: true, dead: false }
  }

  // ── blok bantu: resolusi penerima segmen (paritas services/broadcast.py) ──
  function segmentUserIds(app, segment) {
    const cutoff = pbDate(function () {
      const d = new Date()
      d.setDate(d.getDate() - 7)
      return d
    }())
    let filter = "is_active = {:a}"
    if (segment === "aktif_7hari") filter += " && last_active_date >= {:c}"
    else if (segment === "pasif_7hari") filter += " && (last_active_date = '' || last_active_date < {:c})"
    const params = { a: true, c: cutoff }
    try {
      return app.findRecordsByFilter("users", filter, "", 0, 0, params) || []
    } catch (err) {
      console.log("PUSH: query segmen gagal: " + err)
      return []
    }
  }
  function recipientTokens(app, userId, segment) {
    let users = null
    if (userId) {
      try {
        users = [app.findRecordById("users", userId)]
      } catch (err) {
        return { recipients: 0, tokens: [] }
      }
      if (users.length === 1 && !users[0].get("is_active")) {
        return { recipients: 0, tokens: [] } // akun diblokir tidak pernah menerima push
      }
    } else {
      users = segmentUserIds(app, segment || "all")
    }
    const byId = {}
    for (let i = 0; i < users.length; i++) byId[users[i].id] = true
    let tokenRows = []
    try {
      tokenRows = app.findRecordsByFilter("fcm_tokens", "id != ''", "created", 0, 0) || []
    } catch (err) {
      tokenRows = []
    }
    const tokens = []
    for (let i = 0; i < tokenRows.length; i++) {
      if (byId[String(tokenRows[i].get("user"))]) tokens.push(tokenRows[i])
    }
    return { recipients: users.length, tokens: tokens }
  }

  // ═══════ inti hook ═══════
  const rec = e.record
  const colName = rec.collection().name
  if (colName !== "notifications") return
  const userId = String(rec.get("user") || "")
  const title = rec.get("title") || ""
  const body = rec.get("body") || ""
  const payload = jsonValue(rec.get("payload")) || {}
  const segment = String(payload.segment || "all")

  const target = recipientTokens(e.app, userId, segment)
  let mode = "log"
  let accessToken = ""
  let projectId = ($os.getenv("FCM_PROJECT_ID") || "").trim()
  let creds = null
  const wantFcm = ($os.getenv("PUSH_MODE") || "log").toLowerCase() === "fcm"
  if (wantFcm && projectId) {
    try {
      creds = loadCredentials()
    } catch (err) {
      console.log("PUSH_MODE=fcm tapi kredensial tidak layak — fallback log: " + err)
      creds = null
    }
  } else if (wantFcm && !projectId) {
    console.log("PUSH_MODE=fcm tapi FCM_PROJECT_ID kosong — fallback log.")
  }
  if (wantFcm && creds && projectId) {
    try {
      accessToken = getAccessToken(e.app, creds, projectId)
      mode = "fcm"
    } catch (err) {
      console.log("OAuth FCM gagal — fallback log: " + err)
    }
  }

  const data = {
    notification_id: rec.id,
    type: rec.get("type") || "info",
    kind: String(payload.kind || ""),
    broadcast: userId ? "false" : "true",
  }
  let sent = 0
  let dead = 0
  for (let i = 0; i < target.tokens.length; i++) {
    const t = target.tokens[i]
    try {
      const out = sendOne(mode, accessToken, projectId, t.get("token"), title, body, data)
      if (out.sent) sent++
      if (out.dead) {
        dead++
        try {
          e.app.delete(t)
        } catch (err) {}
      }
    } catch (err) {
      console.log("PUSH error token=" + String(t.get("token")).slice(0, 12) + "…: " + err)
    }
  }
  console.log(
    "PUSH notif=" + rec.id + " user=" + (userId || "broadcast") + " segment=" + segment +
      " penerima=" + target.recipients + " token=" + target.tokens.length +
      " terkirim=" + sent + " mode=" + mode
  )

  // Rekap ke payload — riwayat komposer cukup dari DB (paritas FastAPI).
  try {
    const recap = {
      push: {
        recipients: target.recipients,
        tokens: target.tokens.length,
        sent: sent,
        dead: dead,
        mode: mode,
      },
    }
    const merged = Object.assign({}, payload, recap)
    rec.set("payload", merged)
    e.app.save(rec)
  } catch (err) {
    console.log("PUSH: rekap payload gagal ditulis: " + err)
  }
}, "notifications")

// ═══════ 2. Composer broadcast (role admin) ═══════

routerAdd("POST", "/api/ekoteologi/admin/push/broadcast", (e) => {
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
  if (!auth || auth.collection().name !== "users" || auth.get("role") !== "admin") {
    throw new UnauthorizedError("Hanya admin yang dapat mengirim broadcast.")
  }
  const body = e.requestInfo().body || {}
  const title = String(body.title || "").trim()
  const text = String(body.body || "").trim()
  const segment = String(body.segment || "all").trim() || "all"
  const SEGMENTS = ["all", "aktif_7hari", "pasif_7hari", "bertoken"]
  if (SEGMENTS.indexOf(segment) === -1) {
    throw new ApiError(400, "Segmen tidak dikenali — pilih salah satu: " + SEGMENTS.join(", ") + ".")
  }
  if (title.length < 4 || title.length > 64) {
    throw new ApiError(400, "Judul minimal 4 dan maksimal 64 karakter.")
  }
  if (text.length < 8 || text.length > 300) {
    throw new ApiError(400, "Isi pesan minimal 8 dan maksimal 300 karakter.")
  }

  let notifId = ""
  e.app.runInTransaction(function (txApp) {
    // Pipeline push hidup di hook afterCreate (atas) — rekap {recipients,
    // tokens, sent} otomatis ditulis ke payload.setelah save (synchronous).
    const rec = new Record(txApp.findCollectionByNameOrId("notifications"))
    rec.set("title", title)
    rec.set("body", text)
    rec.set("type", "info")
    rec.set("payload", { kind: "broadcast", segment: segment })
    txApp.save(rec)
    notifId = rec.id
  })

  let stored = null
  try {
    stored = e.app.findRecordById("notifications", notifId)
  } catch (err) {
    stored = null
  }
  const payload = stored ? jsonValue(stored.get("payload")) || {} : {}
  const pushRecap = payload.push || {}

  // Audit rekap (pola admin_push.py — bisa diaudit tanpa buka log aplikasi).
  try {
    const col = e.app.findCollectionByNameOrId("audit_logs")
    const recAudit = new Record(col)
    recAudit.set("actor", auth.id)
    recAudit.set("action", "push.broadcast")
    recAudit.set("entity", "notifications")
    recAudit.set("entity_id", notifId)
    recAudit.set("diff", {
      title: title,
      segment: segment,
      recipients: pushRecap.recipients || 0,
      tokens: pushRecap.tokens || 0,
      sent: pushRecap.sent || 0,
      mode: pushRecap.mode || "log",
      _actor: "user",
    })
    e.app.save(recAudit)
  } catch (err) {
    console.log("BROADCAST: audit gagal menulis: " + err)
  }
  console.log(
    "PUSH BROADCAST id=" + notifId + " segment=" + segment +
      " penerima=" + (pushRecap.recipients || 0) + " token=" + (pushRecap.tokens || 0) +
      " terkirim=" + (pushRecap.sent || 0) + " admin=" + auth.id
  )
  return e.json(200, {
    id: notifId,
    title: title,
    body: text,
    segment: segment,
    recipients: pushRecap.recipients || 0,
    tokens: pushRecap.tokens || 0,
    sent: pushRecap.sent || 0,
  })
}, $apis.requireAuth("users"))

// ═══════ 3. Preview segmen (role admin) ═══════

routerAdd("GET", "/api/ekoteologi/admin/push/segments", (e) => {
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
    throw new UnauthorizedError("Hanya admin yang dapat melihat segmen push.")
  }
  const LABELS = {
    all: "Semua pengguna aktif",
    aktif_7hari: "Aktif 7 hari terakhir",
    pasif_7hari: "Pasif lebih dari 7 hari",
    bertoken: "Punya token push (FCM)",
  }
  function usersOf(app, segment) {
    const cutoff = pbDate(function () {
      const d = new Date()
      d.setDate(d.getDate() - 7)
      return d
    }())
    let filter = "is_active = {:a}"
    if (segment === "aktif_7hari") filter += " && last_active_date >= {:c}"
    else if (segment === "pasif_7hari") filter += " && (last_active_date = '' || last_active_date < {:c})"
    try {
      return app.findRecordsByFilter("users", filter, "", 0, 0, { a: true, c: cutoff }) || []
    } catch (err) {
      return []
    }
  }
  let tokenRows = []
  try {
    tokenRows = e.app.findRecordsByFilter("fcm_tokens", "id != ''", "created", 0, 0) || []
  } catch (err) {
    tokenRows = []
  }
  const items = []
  for (const seg of ["all", "aktif_7hari", "pasif_7hari", "bertoken"]) {
    const users = usersOf(e.app, seg)
    const byId = {}
    for (let i = 0; i < users.length; i++) byId[users[i].id] = true
    let tokens = 0
    for (let i = 0; i < tokenRows.length; i++) {
      if (byId[String(tokenRows[i].get("user"))]) tokens++
    }
    items.push({
      segment: seg,
      label: LABELS[seg],
      recipients: users.length,
      tokens: tokens,
    })
  }
  return e.json(200, { items: items })
}, $apis.requireAuth("users"))

// ═══════ 4. Guard update notifications — hanya read_at ═══════
// updateRule OWN membatasi pemilik, tapi tidak membatasi FIELD: tanpa guard
// ini user bisa mengubah judul/isi notifikasi miliknya (deface in-app).

onRecordUpdateRequest((e) => {
  const auth = e.auth
  const isSuperuser = auth && auth.collection().name === "_superusers"
  if (isSuperuser) {
    return e.next()
  }
  if (!auth) {
    throw new ApiError(403, "Butuh autentikasi.")
  }
  const body = e.requestInfo().body || {}
  const keys = Object.keys(body)
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== "read_at") {
      throw new ApiError(403, "Hanya status baca (read_at) yang boleh diubah.")
    }
  }
  return e.next()
}, "notifications")
