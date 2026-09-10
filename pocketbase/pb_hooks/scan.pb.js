/// <reference path="../pb_data/types.d.ts" />
// Ekoteologi AR — Sprint 11: Scan AI via custom route (pb_hooks/scan.pb.js).
//
// Route & hook pada file ini:
//   1. POST /api/ekoteologi/scan       — foto → LLM → JSON tervalidasi →
//      tersimpan + poin (ledger append-only + sinkron users.points).
//   2. GET  /api/ekoteologi/scan/quota — kuota harian user (paritas
//      GET /v1/scans/quota FastAPI).
//   3. GET  /api/ekoteologi/scan/stats — statistik cache hit/miss (target
//      hit rate ≥70% — PRD §5.10 #6; agregasi dashboard menyusul Sprint 13).
//   4. Hook ledger `point_transactions` — append-only + sinkron `users.points`
//      (PRD §5.10 #1). Hook MODEL-level: dipicu JUGA oleh tulisan internal
//      hook (runInTransaction) sehingga scan→poin atomik, dan dipakai ulang
//      Sprint 12 (klaim misi/verifikasi). Koleksi terkunci dari API publik.
//
// Konfigurasi env (lihat .env.example): LLM_MODE (mock|live — mock default
// dev/test), LLM_BASE_URL (9Router 127.0.0.1:20128/v1), LLM_MODEL,
// LLM_FALLBACK_MODEL, LLM_MAX_RETRIES, LLM_TIMEOUT_SECONDS, LLM_MAX_TOKENS,
// SCAN_DAILY_LIMIT (default 20), SCAN_IMAGE_MAX_MB (default 5),
// SCAN_CACHE_TTL_HOURS (default 24).
//
// PENTING — batasan JSVM v0.40 (temuan sprint 9/10/11, terverifikasi):
//   - Handler hook dikirim ke Go sebagai SUMBER fungsi (stringify) lalu
//     dikompilasi ulang di executor VM pool. Closure atas const/fungsi
//     top-level file TIDAK terbawa (helper top-level → ReferenceError).
//     Maka SELURUH helper (bank quote, base64, LLM, cache, kuota) hidup DI
//     DALAM tiap handler; duplikasi antar handler DISENGAJA.
//   - `$app.store()` = satu-satunya state in-memory yang benar-benar lintas
//     executor (Go-side); dipakai sbg L1 cache scan. Nilai disimpan sbg
//     STRING JSON agar aman antar VM. Lapisan tahan-restart = llm_cache (L2).
//   - `get()` pada field json mengembalikan array bita JSON — wajib
//     dinormalisasi (helper jsonValue()).
//   - `$security.sha256(str)` menaikkan byte ≥0x80 jadi 2 byte UTF-8 (string
//     biner rusak); string ASCII aman. Digest foto = sha256 Go-side atas
//     representasi BASE64 (ASCII) byte foto — setara hash konten, cepat.
//     (sha256 murni-JS terbukti benar tapi ~2 dtk/512KB di goja — tak layak.)
//   - Base64 byte foto dibangun manual di JS (tak ada btoa di JSVM); byte
//     dibaca Go-side via `toBytes(file.reader.open(), …)` → array bita eksak.

// ═══════════════════ 1. POST /api/ekoteologi/scan ═══════════════════

routerAdd("POST", "/api/ekoteologi/scan", (e) => {
  // ── konfigurasi env ──
  function envPosInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n <= 0 ? fallback : n
  }
  // varian utk nilai 0 sah (mis. LLM_MAX_RETRIES=0 = tanpa retry)
  function envInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n < 0 ? fallback : n
  }
  const MAX_MB = envPosInt("SCAN_IMAGE_MAX_MB", 5)
  const MAX_BYTES = MAX_MB * 1024 * 1024
  const DAILY_LIMIT = envPosInt("SCAN_DAILY_LIMIT", 20)
  const CACHE_TTL_MS = envPosInt("SCAN_CACHE_TTL_HOURS", 24) * 3600 * 1000
  const LLM_MODE = ($os.getenv("LLM_MODE") || "mock").toLowerCase()
  const LLM_BASE_URL = $os.getenv("LLM_BASE_URL") || "http://127.0.0.1:20128/v1"
  const LLM_MODEL = $os.getenv("LLM_MODEL") || ""
  const LLM_FALLBACK_MODEL = $os.getenv("LLM_FALLBACK_MODEL") || ""
  const LLM_MAX_RETRIES = envInt("LLM_MAX_RETRIES", 1)
  const LLM_TIMEOUT = envPosInt("LLM_TIMEOUT_SECONDS", 30)
  const LLM_MAX_TOKENS = envPosInt("LLM_MAX_TOKENS", 500)

  // ── auth (middleware requireAuth sudah menjaga; guard defensif) ──
  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
  }
  const uid = auth.id

  // ── util biner: base64 + digest (lihat catatan JSVM di atas) ──
  const B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  function b64encode(u8) {
    const out = []
    const n = u8.length
    for (let i = 0; i < n; i += 3) {
      const b0 = u8[i]
      const b1 = i + 1 < n ? u8[i + 1] : -1
      const b2 = i + 2 < n ? u8[i + 2] : -1
      out.push(
        B64C[b0 >> 2] +
          B64C[((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4)] +
          (b1 < 0 ? "=" : B64C[((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6)]) +
          (b2 < 0 ? "=" : B64C[b2 & 63])
      )
    }
    return out.join("")
  }
  function detectMime(b) {
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
    if (
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
    ) return "image/png"
    if (
      b.length > 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
    ) return "image/webp"
    return ""
  }

  // ── ambil & validasi foto (ukuran + magic bytes) ──
  let fileObj = null
  try {
    const files = e.findUploadedFiles("image")
    if (files && files.length > 0) fileObj = files[0]
  } catch (err) {
    fileObj = null
  }
  if (!fileObj || !fileObj.size) {
    throw new BadRequestError("Foto scan kosong. Ambil foto objek sampah terlebih dahulu.")
  }
  if (fileObj.size > MAX_BYTES) {
    throw new ApiError(413, "Ukuran foto maksimal " + MAX_MB + " MB.")
  }

  const bytes = toBytes(fileObj.reader.open(), MAX_BYTES + 1)
  if (!bytes || bytes.length === 0) {
    throw new BadRequestError("Foto scan kosong. Ambil foto objek sampah terlebih dahulu.")
  }
  const u8 = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) u8[i] = bytes[i]
  const mime = detectMime(u8)
  if (!mime) {
    throw new BadRequestError("Format foto harus JPG, PNG, atau WebP.")
  }
  const imageB64 = b64encode(u8)
  // Digest = sha256 (Go) atas base64 (ASCII) — byte-exact & cepat.
  const digest = $security.sha256(imageB64)

  // ── kategori dari DB (daftar diizinkan + base_points) ──
  function loadCategories(app) {
    const rows = app.findRecordsByFilter("waste_categories", "id != ''", "name", 0, 0) || []
    const cats = []
    for (let i = 0; i < rows.length; i++) {
      cats.push({
        id: rows[i].id,
        name: rows[i].get("name") || "",
        icon: rows[i].get("icon") || "",
        base_points: rows[i].get("base_points") || 0,
      })
    }
    return cats
  }
  const categories = loadCategories(e.app)
  if (categories.length === 0) {
    throw new ApiError(503, "Layanan analisis belum siap (kategori sampah belum terisi). Coba beberapa saat lagi.")
  }
  function categoryNames(cats) {
    const names = []
    for (let i = 0; i < cats.length; i++) names.push(cats[i].name)
    return names
  }

  // ── bank quote terkurasi (anti-halusinasi — PRD §9): server SELALU
  //    mengganti quote LLM dgn entri bank sesuai kategori.
  function quoteFor(name) {
    const bank = {
      Organik: {
        text: "Dia menciptakan kamu dari bumi dan memakmurkannya (meminta kamu memakmurnya).",
        source: "QS Hud: 61",
      },
      Plastik: {
        text: "Sesungguhnya Allah tidak menyukai orang yang berlebih-lebihan (berbuat rusak).",
        source: "QS Al-An'am: 141",
      },
      Kertas: {
        text:
          "Tidaklah seorang muslim menanam pohon lalu darinya dimakan burung, manusia, " +
          "atau hewan, melainkan itu menjadi sedekah baginya.",
        source: "HR Bukhari no. 2320",
      },
      Kaca: {
        text:
          "Allah adalah cahaya langit dan bumi. Perumpamaan cahaya-Nya seperti sebuah " +
          "cermin (mishkah) di dalamnya ada lampu.",
        source: "QS An-Nur: 35",
      },
      Logam: {
        text:
          "Dan sungguh Kami telah mengirim besi yang padanya terdapat kekuatan hebat dan " +
          "berbagai manfaat bagi manusia.",
        source: "QS Al-Hadid: 25",
      },
      B3: {
        text: "Janganlah kamu berbuat kerusakan di bumi setelah (diciptakan) dengan baik.",
        source: "QS Al-A'raf: 56",
      },
      Residu: {
        text:
          "Iman itu ada tujuh puluh sekian cabang; yang tertinggi adalah laa ilaaha " +
          "illallah, dan yang terendah adalah menyingkirkan gangguan dari jalan.",
        source: "HR Muslim no. 35",
      },
    }
    return (
      bank[name] || {
        text:
          "Dunia itu hijau dan manis; sungguh Allah menjadikan kalian khalifah di dalamnya, " +
          "maka perhatikanlah bagaimana kalian berbuat.",
        source: "HR Muslim no. 2742",
      }
    )
  }

  // ── prompt (Bahasa Indonesia, JSON ketat — port llm/base.py) ──
  function systemPrompt(cats) {
    return (
      "Kamu adalah asisten pemilah sampah untuk aplikasi edukasi lingkungan " +
      "Ekoteologi AR. Tugasmu: mengenali satu objek sampah utama pada foto lalu menjawab HANYA " +
      "dengan satu objek JSON valid (tanpa penjelasan lain) dengan bentuk:\n\n" +
      '{"item_name": "...", "category": "...", "advice": "...", ' +
      '"quote": {"text": "...", "source": "..."}, "points": 0}\n\n' +
      "Aturan:\n" +
      "1. `item_name`: nama objek spesifik dalam Bahasa Indonesia (maks 100 karakter).\n" +
      "2. `category`: HARUS persis salah satu dari daftar berikut: " +
      categoryNames(cats).join(", ") + ".\n" +
      "3. `advice`: 1-3 kalimat saran pembuangan/pengolahan yang benar dan aman (Bahasa Indonesia).\n" +
      "4. `quote`: kutipan ayat Al-Qur'an atau hadis singkat yang relevan dengan menjaga kelestarian " +
      'bumi/kebersihan, beserta sumbernya (mis. "QS Ar-Rum: 41" atau "HR Bukhari no. 2320"). ' +
      'Jika tidak yakin, isi dengan {"text": "", "source": ""} — aplikasi akan memakai bank kutipan ' +
      "terkurasi. JANGAN mengarang sumber.\n" +
      "5. `points`: angka bulatan 0-100 yang mencerminkan manfaat memilah objek ini (B3/daur ulang " +
      "bernilai lebih tinggi, residu rendah).\n" +
      "Jawab HANYA JSON. Tanpa markdown, tanpa teks lain."
    )
  }

  // ── validasi hasil LLM (port ScanLLMResult) ──
  function llmError(msg) {
    return new Error("LLM_INVALID: " + msg)
  }
  function parseLlmContent(content, catNames) {
    let text = (content || "").trim()
    if (text.indexOf("```") === 0) {
      text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")
    }
    text = text.trim()
    let payload
    try {
      payload = JSON.parse(text)
    } catch (err) {
      throw llmError("Respons LLM bukan JSON valid.")
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw llmError("Respons LLM bukan objek JSON.")
    }
    const itemName = typeof payload.item_name === "string" ? payload.item_name.trim() : ""
    const category = typeof payload.category === "string" ? payload.category.trim() : ""
    const advice = typeof payload.advice === "string" ? payload.advice.trim() : ""
    const points = payload.points
    if (itemName.length < 2 || itemName.length > 100) {
      throw llmError("item_name harus 2-100 karakter.")
    }
    if (advice.length < 5 || advice.length > 1000) {
      throw llmError("advice harus 5-1000 karakter.")
    }
    if (
      typeof points !== "number" ||
      !isFinite(points) ||
      Math.floor(points) !== points ||
      points < 0 ||
      points > 100
    ) {
      throw llmError("points harus bulat 0-100.")
    }
    let canonical = ""
    const lower = category.toLowerCase()
    for (let i = 0; i < catNames.length; i++) {
      if ((catNames[i] || "").toLowerCase() === lower) {
        canonical = catNames[i]
        break
      }
    }
    if (!canonical) {
      throw llmError("Kategori '" + category + "' tidak dikenal.")
    }
    let quote = null
    if (payload.quote && typeof payload.quote === "object" && !Array.isArray(payload.quote)) {
      if (typeof payload.quote.text === "string" && typeof payload.quote.source === "string") {
        quote = { text: payload.quote.text, source: payload.quote.source }
      }
    }
    return { item_name: itemName, category: canonical, advice: advice, points: points, quote: quote }
  }

  // ── provider mock: deterministik dari digest (port llm/mock.py) ──
  function mockAnalyze(digestHex, catNames) {
    const items = [
      {
        item_name: "Botol plastik bekas air mineral",
        category: "Plastik",
        advice:
          "Kosongkan, bilas, dan penyetek labelnya lalu buang ke tempat sampah plastik " +
          "atau setor ke bank sampah agar didaur ulang.",
        points: 5,
      },
      {
        item_name: "Kulit pisang",
        category: "Organik",
        advice:
          "Masukkan ke tempat sampah organik; lebih baik lagi dijadikan kompos atau " +
          "pupuk fermentasi di rumah.",
        points: 5,
      },
      {
        item_name: "Kardus bekas",
        category: "Kertas",
        advice:
          "Lipat rapi agar hemat tempat lalu buang di tempat sampah kertas atau jual ke " +
          "pemulung/bank sampah.",
        points: 4,
      },
      {
        item_name: "Botol kaca bersisa saus",
        category: "Kaca",
        advice:
          "Bilas hingga bersih lalu buang pada tempat sampah kaca; kaca utuh bisa " +
          "digunakan ulang sebagai wadah.",
        points: 4,
      },
      {
        item_name: "Kaleng aluminium bekas minuman",
        category: "Logam",
        advice:
          "Bilas dan remas kalengnya, lalu setorkan ke bank sampah — aluminium sangat " +
          "layak didaur ulang.",
        points: 5,
      },
      {
        item_name: "Baterai bekas",
        category: "B3",
        advice:
          "Jangan dibuang ke sampah biasa; kumpulkan dan serahkan ke titik pengumpulan " +
          "B3 (mis. dropbox gerai ritel) agar tidak mencemari tanah dan air.",
        points: 10,
      },
      {
        item_name: "Popok sekali pakai",
        category: "Residu",
        advice:
          "Buang ke tempat sampah residu yang tertutup; popok tidak dapat didaur ulang " +
          "sementara ini.",
        points: 2,
      },
    ]
    let h = 0
    for (let i = 0; i < digestHex.length; i++) {
      h = (h * 31 + parseInt(digestHex[i], 16)) >>> 0
    }
    const item = items[h % items.length]
    // lewat validator yang sama dgn jalur live (paritas kontrak respons)
    const payload = JSON.stringify({
      item_name: item.item_name,
      category: item.category,
      advice: item.advice,
      quote: { text: "", source: "" },
      points: item.points,
    })
    return parseLlmContent(payload, catNames)
  }

  // ── provider live: 9Router OpenAI-compatible (port llm/openai_compat.py) ──
  // Temuan live 9Router: respons bisa berakhiran "data: [DONE]\n\n" (SSE-style)
  // → `$http.send().json` gagal; maka body bita diubah ke string lalu JSON
  // diekstraksi toleran (potong di '}' terakhir bila ada data ekor).
  function bodyToJson(res) {
    let text = ""
    try {
      const parts = []
      const rawBody = res.body || []
      for (let i = 0; i < rawBody.length; i += 8192) {
        parts.push(String.fromCharCode.apply(null, rawBody.slice(i, i + 8192)))
      }
      text = parts.join("")
    } catch (err) {
      throw new Error("LLM_UPSTREAM: bentuk respons provider tidak dikenal.")
    }
    try {
      return JSON.parse(text)
    } catch (err) {
      const lastBrace = text.lastIndexOf("}")
      if (lastBrace > 0) {
        try {
          return JSON.parse(text.slice(0, lastBrace + 1))
        } catch (err2) {
          /* jatuh ke error di bawah */
        }
      }
      throw new Error("LLM_UPSTREAM: bentuk respons provider tidak dikenal.")
    }
  }
  function contentText(msg) {
    // Sebagian provider mengembalikan content berbentuk array of parts.
    if (Array.isArray(msg)) {
      const parts = []
      for (let i = 0; i < msg.length; i++) {
        if (typeof msg[i] === "string") parts.push(msg[i])
        else if (msg[i] && typeof msg[i].text === "string") parts.push(msg[i].text)
      }
      return parts.join("")
    }
    return typeof msg === "string" ? msg : ""
  }
  function callModel(model, b64, mimeVal, cats) {
    const payload = JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt(cats) },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:" + mimeVal + ";base64," + b64 } },
            { type: "text", text: "Apa sampah pada foto ini? Jawab hanya JSON." },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: LLM_MAX_TOKENS,
    })
    let res
    try {
      res = $http.send({
        url: LLM_BASE_URL.replace(/\/+$/, "") + "/chat/completions",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        timeout: LLM_TIMEOUT,
      })
    } catch (err) {
      throw new Error("LLM_UPSTREAM: permintaan ke provider gagal (" + err + ")")
    }
    if (res.statusCode >= 400) {
      throw new Error("LLM_UPSTREAM: provider merespons " + res.statusCode)
    }
    const data = bodyToJson(res)
    let content = ""
    try {
      content = contentText(data.choices[0].message.content)
    } catch (err) {
      throw new Error("LLM_UPSTREAM: bentuk respons provider tidak dikenal.")
    }
    if (!content || !content.trim()) {
      throw new Error("LLM_UPSTREAM: konten respons kosong (kuota token habis utk reasoning?)")
    }
    const result = parseLlmContent(content, categoryNames(cats))
    return { result: result, raw: data, tokens: data.usage || null }
  }

  function analyze(b64, mimeVal, cats) {
    const started = Date.now()
    let attempts = 0
    function runModel(model) {
      let err = null
      let out = null
      for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
        attempts++
        try {
          out = callModel(model, b64, mimeVal, cats)
          err = null
          break
        } catch (e) {
          err = e
          if (attempt < LLM_MAX_RETRIES) {
            sleep(500 * (attempt + 1)) // goja punya sleep() — pengganti backoff asyncio
          }
        }
      }
      if (err) throw err
      return out
    }

    let response = null
    let fallbackUsed = false
    try {
      response = runModel(LLM_MODEL)
    } catch (primaryError) {
      if (!LLM_FALLBACK_MODEL) {
        throw primaryError
      }
      console.log("SCAN LLM: model primer gagal total — beralih ke fallback: " + primaryError)
      response = runModel(LLM_FALLBACK_MODEL)
      fallbackUsed = true
    }
    response.latency_ms = Date.now() - started
    response.attempts = attempts
    response.fallback_used = fallbackUsed
    return response
  }

  // ── app_settings: nilai json (temuan v0.40: get() json → array bita) ──
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
  function readSetting(app, key) {
    try {
      const rec = app.findFirstRecordByFilter("app_settings", "key = {:key}", { key: key })
      return jsonValue(rec.get("value"))
    } catch (err) {
      return null
    }
  }
  function writeSetting(app, key, value) {
    let rec = null
    try {
      rec = app.findFirstRecordByFilter("app_settings", "key = {:key}", { key: key })
    } catch (err) {
      rec = null
    }
    if (!rec) {
      rec = new Record(app.findCollectionByNameOrId("app_settings"))
      rec.set("key", key)
    }
    rec.set("value", value)
    app.save(rec)
  }

  function todayLocal() {
    const d = new Date()
    const mm = d.getMonth() + 1
    const dd = d.getDate()
    return d.getFullYear() + "-" + (mm < 10 ? "0" + mm : mm) + "-" + (dd < 10 ? "0" + dd : dd)
  }
  function secondsUntilMidnight() {
    const now = new Date()
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    return Math.max(60, Math.floor((tomorrow.getTime() - now.getTime()) / 1000))
  }

  // ── kuota harian (fail-closed — pelindung beban 9Router, paritas scan_limit) ──
  const quotaKey = "scan_quota:" + uid + ":" + todayLocal()
  let used = 0
  try {
    e.app.runInTransaction(function (txApp) {
      const entry = readSetting(txApp, quotaKey) || { count: 0 }
      entry.count = (entry.count || 0) + 1
      writeSetting(txApp, quotaKey, entry)
      used = entry.count
    })
  } catch (err) {
    console.log("SCAN: kuota tidak dapat dicatat (fail-closed): " + err)
    throw new ApiError(503, "Layanan scan sedang tidak tersedia. Coba beberapa saat lagi.")
  }
  if (used > DAILY_LIMIT) {
    const resetIn = secondsUntilMidnight()
    try {
      e.response.header().set("Retry-After", String(resetIn))
    } catch (err) {
      /* header tetap dikirim; body di bawah membawa retry_after juga */
    }
    console.log("SCAN ditolak: kuota harian habis user=" + uid + " used=" + used)
    // e.json (bukan ApiError) agar bentuk body penuh di tangan kita —
    // parameter data ApiError PB diformat sbg error validasi per field.
    return e.json(429, {
      code: 429,
      message:
        "Kuota scan harian habis (maksimal " + DAILY_LIMIT + " kali per hari). Coba lagi besok.",
      retry_after: resetIn,
    })
  }

  // ── cache L1 ($app.store — in-memory lintas executor, string JSON) + L2 llm_cache ──
  function memGet(app, key) {
    try {
      const raw = app.store().get(key)
      if (!raw) return null
      const entry = JSON.parse(raw)
      if (!entry || !entry.expires || Date.now() > entry.expires) {
        app.store().remove(key)
        return null
      }
      return entry.value
    } catch (err) {
      return null
    }
  }
  function memSet(app, key, value) {
    try {
      app
        .store()
        .set(key, JSON.stringify({ value: value, expires: Date.now() + CACHE_TTL_MS }))
    } catch (err) {
      /* L1 best-effort */
    }
  }
  function cacheGet(app, key) {
    const m = memGet(app, key)
    if (m) return m
    try {
      const rec = app.findFirstRecordByFilter("llm_cache", "key = {:key}", { key: key })
      const value = jsonValue(rec.get("value"))
      // Kedaluwarsa disimpan dlm value (ms epoch) agar perbandingan tak
      // bergantung representasi DateTime JSVM; field `expires` (date) tetap
      // diisi utk pembersihan SQL/cron menyusul.
      if (value && typeof value === "object") {
        if (value.expires_ms && Date.now() > value.expires_ms) {
          try {
            app.delete(rec)
          } catch (err) {
            /* pembersihan best-effort */
          }
          return null
        }
        memSet(app, key, value)
        return value
      }
      return null
    } catch (err) {
      return null
    }
  }
  function cacheStore(app, key, value) {
    const payload = {}
    const keys = Object.keys(value)
    for (let i = 0; i < keys.length; i++) payload[keys[i]] = value[keys[i]]
    payload.expires_ms = Date.now() + CACHE_TTL_MS
    let rec = null
    try {
      rec = app.findFirstRecordByFilter("llm_cache", "key = {:key}", { key: key })
    } catch (err) {
      rec = null
    }
    if (!rec) {
      rec = new Record(app.findCollectionByNameOrId("llm_cache"))
      rec.set("key", key)
    }
    rec.set("value", payload)
    rec.set("expires", new Date(payload.expires_ms).toISOString())
    app.save(rec)
    memSet(app, key, payload)
  }
  function bumpCacheStats(app, kind) {
    const stats = readSetting(app, "scan_cache_stats") || { hit: 0, miss: 0 }
    stats[kind] = (stats[kind] || 0) + 1
    writeSetting(app, "scan_cache_stats", stats)
  }

  const cacheKey = "scan:" + digest
  let cachedPayload = cacheGet(e.app, cacheKey)
  let cached = !!cachedPayload
  if (cachedPayload) {
    console.log("SCAN cache HIT digest=" + digest.slice(0, 12) + " user=" + uid)
    bumpCacheStats(e.app, "hit")
  } else {
    console.log(
      "SCAN cache MISS digest=" + digest.slice(0, 12) + " — memanggil LLM (mode=" + LLM_MODE + ")"
    )
    bumpCacheStats(e.app, "miss")
    const started = Date.now()
    let result = null
    let llmRaw = null
    let llmMeta = null
    if (LLM_MODE === "live" && LLM_MODEL) {
      let analysis = null
      try {
        analysis = analyze(imageB64, mime, categories)
      } catch (err) {
        console.log("SCAN gagal: LLM tidak merespons valid — " + err)
        throw new ApiError(502, "Layanan analisis sedang gangguan. Silakan coba lagi beberapa saat.")
      }
      result = analysis.result
      llmRaw = analysis.raw
      llmMeta = {
        provider: "openai-compatible",
        model: analysis.fallback_used ? LLM_FALLBACK_MODEL : LLM_MODEL,
        latency_ms: analysis.latency_ms,
        tokens: analysis.tokens || null,
        attempts: analysis.attempts,
        fallback_used: analysis.fallback_used,
      }
    } else {
      result = mockAnalyze(digest, categoryNames(categories))
      llmRaw = result
      llmMeta = {
        provider: "mock",
        model: "mock",
        latency_ms: Date.now() - started,
        tokens: null,
        attempts: 1,
        fallback_used: false,
      }
    }

    cachedPayload = {
      item_name: result.item_name,
      category: result.category,
      advice: result.advice,
      points: result.points,
      llm_raw: llmRaw,
      llm_meta: llmMeta,
    }
    try {
      cacheStore(e.app, cacheKey, cachedPayload)
    } catch (err) {
      console.log("SCAN: hasil tidak dapat dicache (dilanjutkan tanpa cache): " + err)
    }
  }

  // ── kategori + poin ──
  let category = null
  const lowerCat = (cachedPayload.category || "").toLowerCase()
  for (let i = 0; i < categories.length; i++) {
    if ((categories[i].name || "").toLowerCase() === lowerCat) {
      category = categories[i]
      break
    }
  }
  if (!category) {
    throw new ApiError(502, "Kategori hasil analisis tidak dikenali.")
  }

  // Foto byte-identikal dari user sama pada hari sama → poin 0 (anti poin-farming).
  // Satu baris app_settings per user+hari (kunci ≤50 karakter!) berisi daftar
  // prefix 32-hex digest (128-bit — cukup utk identitas byte).
  let duplicate = false
  try {
    e.app.runInTransaction(function (txApp) {
      const dupKey = "sd:" + uid + ":" + todayLocal()
      const entry = readSetting(txApp, dupKey) || { digests: [] }
      const digests = Array.isArray(entry.digests) ? entry.digests : []
      const prefix = digest.slice(0, 32)
      if (digests.indexOf(prefix) !== -1) {
        duplicate = true
        return
      }
      digests.push(prefix)
      entry.digests = digests
      writeSetting(txApp, dupKey, entry)
    })
  } catch (err) {
    console.log("SCAN: fingerprint duplikat tidak dapat dicatat (dilanjutkan): " + err)
  }

  const llmPoints = cachedPayload.points || 0
  const points = duplicate ? 0 : Math.min(llmPoints, category.base_points || 0)
  const quote = quoteFor(category.name)

  const meta = {}
  const metaKeys = Object.keys(cachedPayload.llm_meta || {})
  for (let i = 0; i < metaKeys.length; i++) {
    meta[metaKeys[i]] = cachedPayload.llm_meta[metaKeys[i]]
  }
  meta.cached = cached

  // ── simpan scan + poin (satu transaksi; hook ledger menyinkron users.points) ──
  let scanId = ""
  let imageName = ""
  let pointsTotal = 0
  let isFirstScan = false
  try {
    e.app.runInTransaction(function (txApp) {
      try {
        isFirstScan = txApp.countRecords("scans", $dbx.hashExp({ user: uid })) === 0
      } catch (err) {
        isFirstScan = false
      }

      const scanCol = txApp.findCollectionByNameOrId("scans")
      const scan = new Record(scanCol)
      scan.set("user", uid)
      scan.set("image", fileObj)
      scan.set("item_name", (cachedPayload.item_name || "").slice(0, 100))
      scan.set("category", category.id)
      scan.set("advice", cachedPayload.advice || "")
      scan.set("quote", { text: quote.text, source: quote.source })
      scan.set("llm_raw", cachedPayload.llm_raw)
      scan.set("llm_meta", meta)
      scan.set("points", points)
      txApp.save(scan)
      scanId = scan.id
      imageName = scan.get("image") || ""

      if (points > 0) {
        // Ledger append-only — hook `point_transactions` (bawah) menyinkron
        // users.points dalam transaksi yang sama (PRD §5.10 #1).
        const ledgerCol = txApp.findCollectionByNameOrId("point_transactions")
        const txn = new Record(ledgerCol)
        txn.set("user", uid)
        txn.set("amount", points)
        txn.set("source", "scan")
        txn.set("ref_id", scan.id)
        txn.set("note", "Scan: " + (cachedPayload.item_name || ""))
        txApp.save(txn)
      }

      if (isFirstScan) {
        // Metrik aktivasi (PRD §8): event scan_pertama.
        const evCol = txApp.findCollectionByNameOrId("analytics_events")
        const ev = new Record(evCol)
        ev.set("user", uid)
        ev.set("name", "scan_pertama")
        ev.set("payload", { scan_id: scan.id, category: category.name, points: points })
        txApp.save(ev)
      }

      const user = txApp.findRecordById("users", uid)
      pointsTotal = user.get("points") || 0
    })
  } catch (err) {
    console.log("SCAN: gagal menyimpan hasil: " + err)
    throw new ApiError(502, "Hasil analisis tidak dapat disimpan. Silakan coba lagi.")
  }

  // Audit manual (paritas middleware audit FastAPI atas POST /v1/scan —
  // pembuatan record via konteks internal tidak memicu hook request).
  try {
    const col = e.app.findCollectionByNameOrId("audit_logs")
    const recAudit = new Record(col)
    recAudit.set("actor", uid)
    recAudit.set("action", "scan")
    recAudit.set("entity", "scans")
    recAudit.set("entity_id", scanId)
    recAudit.set("diff", {
      item_name: cachedPayload.item_name,
      category: category.name,
      points: points,
      cached: cached,
      duplicate: duplicate,
      mode: LLM_MODE === "live" && LLM_MODEL ? "live" : "mock",
      _actor: "user",
    })
    e.app.save(recAudit)
  } catch (err) {
    console.log("SCAN: audit gagal menulis: " + err)
  }

  console.log(
    "SCAN OK id=" + scanId + " user=" + uid + " item='" + cachedPayload.item_name +
      "' category=" + category.name + " points=" + points + " cached=" + cached +
      " duplicate=" + duplicate
  )
  if (isFirstScan) {
    console.log("EVENT scan_pertama user=" + uid + " scan=" + scanId + " (aktivasi — PRD §8)")
  }

  return e.json(200, {
    id: scanId,
    item_name: cachedPayload.item_name,
    category: { id: category.id, name: category.name, icon: category.icon || null },
    advice: cachedPayload.advice,
    quote: { text: quote.text, source: quote.source },
    points: points,
    points_total: pointsTotal,
    cached: cached,
    duplicate: duplicate,
    image: imageName,
    created_at: new Date().toISOString(),
  })
}, $apis.requireAuth("users"))

// ═══════════════════ 2. GET /api/ekoteologi/scan/quota ═══════════════════

routerAdd("GET", "/api/ekoteologi/scan/quota", (e) => {
  function envInt(name, fallback) {
    const raw = $os.getenv(name)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n <= 0 ? fallback : n
  }
  const DAILY_LIMIT = envInt("SCAN_DAILY_LIMIT", 20)

  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
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

  const d = new Date()
  const mm = d.getMonth() + 1
  const dd = d.getDate()
  const today = d.getFullYear() + "-" + (mm < 10 ? "0" + mm : mm) + "-" + (dd < 10 ? "0" + dd : dd)
  let used = 0
  try {
    const rec = e.app.findFirstRecordByFilter(
      "app_settings",
      "key = {:key}",
      { key: "scan_quota:" + auth.id + ":" + today }
    )
    const value = jsonValue(rec.get("value"))
    if (value && value.count) used = value.count
  } catch (err) {
    used = 0
  }
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  const resetsIn = Math.max(0, Math.floor((tomorrow.getTime() - d.getTime()) / 1000))

  return e.json(200, {
    used: used,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - used),
    resets_in_seconds: resetsIn,
  })
}, $apis.requireAuth("users"))

// ═══════════════════ 3. GET /api/ekoteologi/scan/stats ═══════════════════

routerAdd("GET", "/api/ekoteologi/scan/stats", (e) => {
  const auth = e.auth
  if (!auth || auth.collection().name !== "users") {
    throw new UnauthorizedError("Butuh autentikasi.")
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

  let stats = { hit: 0, miss: 0 }
  try {
    const rec = e.app.findFirstRecordByFilter(
      "app_settings",
      "key = {:key}",
      { key: "scan_cache_stats" }
    )
    const value = jsonValue(rec.get("value"))
    if (value) stats = value
  } catch (err) {
    /* belum ada aktivitas scan */
  }
  const total = (stats.hit || 0) + (stats.miss || 0)

  return e.json(200, {
    hit: stats.hit || 0,
    miss: stats.miss || 0,
    total: total,
    hit_rate: total > 0 ? Math.round(((stats.hit || 0) / total) * 100) : 0,
    llm_mode: ($os.getenv("LLM_MODE") || "mock").toLowerCase(),
  })
}, $apis.requireAuth("users"))

// ═══════════ 4. Ledger `point_transactions` — append-only + cache poin ═══════════
// PRD §5.10 #1: `point_transactions` append-only satu-satunya sumber kebenaran;
// `users.points` hanyalah cache yang di-sync dalam transaksi yang sama.
// Hook MODEL-level (bukan request): berlaku juga utk tulisan internal hook
// (scan sprint ini; klaim/verifikasi sprint 12) — e.app sudah txApp.
// Koleksi terkunci dari API (default deny) → jalur penulisan = hook/internal.

onRecordCreate((e) => {
  const amount = e.record.get("amount")
  if (typeof amount !== "number" || !isFinite(amount) || Math.floor(amount) !== amount || amount <= 0) {
    // Pengganti ValueError award_points: ledger hanya menerima penambahan bulat.
    throw new BadRequestError("amount ledger harus angka bulat positif.")
  }
  const uid = e.record.get("user")
  if (!uid) {
    throw new BadRequestError("user ledger wajib diisi.")
  }
  e.next()

  let user = null
  try {
    user = e.app.findRecordById("users", uid)
  } catch (err) {
    throw new BadRequestError("pengguna ledger tidak ditemukan.")
  }
  const current = user.get("points") || 0
  user.set("points", current + amount)
  e.app.save(user)
}, "point_transactions")

// Append-only: UPDATE/DELETE ledger ditolak total (rekonsiliasi = baris baru,
// jalur `adjustment` — PRD §5.10 #1).
onRecordUpdate((e) => {
  throw new BadRequestError("Ledger poin bersifat append-only dan tidak dapat diubah.")
}, "point_transactions")

onRecordDelete((e) => {
  throw new BadRequestError("Ledger poin bersifat append-only dan tidak dapat dihapus.")
}, "point_transactions")
