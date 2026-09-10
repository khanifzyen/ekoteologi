/// <reference path="../pb_data/types.d.ts" />
/**
 * Sprint 9 — port skema FastAPI (api/app/models/*) → koleksi PocketBase.
 *
 * Pemetaan (docs/PRD.md §5):
 *   UUID / BIGSERIAL PK → record id PB (autoid string)
 *   TIMESTAMPTZ created_at → field sistem `created` (autodate bawaan PB)
 *   JSONB → field json · UNIQUE(...) → unique index · REFERENCES → field relasi
 *   image_url/proof_image_url/avatar_url (TEXT) → field `file` (PB-native; di-upload
 *   via multipart di sprint 10–12) — dokumentasi lengkap di pocketbase/README.md.
 *   google_sub tidak di-port — PB menyimpan OAuth eksternal via koleksi sistem
 *   `_authOrigins` (Sprint 10, provider Google bawaan).
 *
 * API rules (pengganti core/deps.require_roles — implementation-plan §5 Sprint 9):
 *   - default deny: koleksi tanpa rule = superuser saja.
 *   - publik baca: kategori/level/badge/misi/konten belajar (modul terbit)/konten harian/peta.
 *   - ownership: `@request.auth.id != "" && user = @request.auth.id`.
 *   - role: @request.auth.role (user|verifier|editor|admin) — admin penuh,
 *     editor konten, verifier antrian verifikasi.
 *
 * Koleksi fase-2 (posts, rewards, map_locations, dll.) ikut dibuat agar skema
 * lengkap meski fiturnya belum aktif.
 */

migrate(
  (app) => {
    function save(spec) {
      app.save(new Collection(spec))
      return app.findCollectionByNameOrId(spec.name)
    }
    function rel(name, col, extra) {
      const f = Object.assign(
        { type: "relation", name: name, collectionId: col.id, maxSelect: 1 },
        extra || {}
      )
      return f
    }

    const ADMIN = '@request.auth.role = "admin"'
    const ADMIN_EDITOR = '(@request.auth.role = "admin" || @request.auth.role = "editor")'
    const AUTHED = '@request.auth.id != ""'
    const OWN = AUTHED + ' && user = @request.auth.id'
    const STAFF = '(@request.auth.role = "admin" || @request.auth.role = "verifier" || @request.auth.role = "editor")'

    // ── users (auth collection — pengganti tabel users + auth JWT manual) ──
    // PB membuat koleksi default `users` pada instalasi baru — hapus dulu agar
    // skema bisa dideklarasikan penuh (aman: migration jalan di instance kosong,
    // sebelum data pengguna ada).
    const defaultUsers = app.findCollectionByNameOrId("users")
    app.delete(defaultUsers)

    const users = save({
      type: "auth",
      name: "users",
      // Leaderboard MVP (PRD §5.10 #7) butuh sort points; admin kelola pengguna.
      listRule: AUTHED,
      viewRule: AUTHED,
      // Registrasi publik (sprint 10): role terkirim harus "user" (atau kosong —
      // dinormalisasi hook create) — mencegah eskalasi role saat daftar;
      // admin (via panel) boleh mengatur role bebas. Catatan v0.40: rule create
      // dievaluasi SEBELUM hook onRecordCreateRequest, maka nilai kosong
      // harus diterima rule dan dinormalisasi sesudahnya.
      createRule: '(role = "user" || role = "" || @request.auth.role = "admin")',
      updateRule: AUTHED + " && (id = @request.auth.id || " + ADMIN + ")",
      deleteRule: ADMIN,
      fields: [
        { type: "text", name: "full_name", required: true, max: 100 },
        { type: "text", name: "phone", max: 20 },
        { type: "file", name: "avatar", maxSelect: 1, maxSize: 2097152, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
        {
          type: "select",
          name: "role",
          // tanpa required: PB tak punya default field — diisi "user" oleh hook
          // create (lihat pb_hooks/main.pb.js)
          maxSelect: 1,
          values: ["user", "verifier", "editor", "admin"],
        },
        { type: "number", name: "points", onlyInt: true, min: 0 }, // cache ledger — hanya diubah hook
        { type: "text", name: "city", max: 100 },
        { type: "number", name: "current_streak", onlyInt: true, min: 0 },
        { type: "number", name: "longest_streak", onlyInt: true, min: 0 },
        { type: "date", name: "last_active_date" },
        { type: "bool", name: "is_active" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX ux_users_phone ON users (phone) WHERE phone != ''",
        "CREATE INDEX ix_users_points ON users (points)",
      ],
    })

    // ── master data tanpa relasi user ──
    const wasteCategories = save({
      type: "base",
      name: "waste_categories",
      listRule: "",
      viewRule: "",
      createRule: ADMIN,
      updateRule: ADMIN,
      deleteRule: ADMIN,
      fields: [
        { type: "text", name: "name", required: true, max: 50, presentable: true },
        { type: "text", name: "icon", max: 50 },
        { type: "number", name: "base_points", onlyInt: true, min: 0 },
      ],
    })

    const levels = save({
      type: "base",
      name: "levels",
      listRule: "",
      viewRule: "",
      createRule: ADMIN,
      updateRule: ADMIN,
      deleteRule: ADMIN,
      fields: [
        { type: "number", name: "level", required: true, onlyInt: true, min: 1, presentable: true },
        // tanpa `required`: PB menolak angka 0 sbg blank — level 1 memang min 0
        { type: "number", name: "min_points", onlyInt: true, min: 0 },
        { type: "text", name: "title", required: true, max: 50 },
      ],
      indexes: ["CREATE UNIQUE INDEX ux_levels_level ON levels (level)"],
    })

    const badges = save({
      type: "base",
      name: "badges",
      listRule: "",
      viewRule: "",
      createRule: ADMIN,
      updateRule: ADMIN,
      deleteRule: ADMIN,
      fields: [
        { type: "text", name: "code", required: true, max: 50, presentable: true },
        { type: "text", name: "name", max: 100 },
        { type: "text", name: "icon", max: 100 },
        { type: "text", name: "description" },
        // {"type":"scan_count","value":50} — dievaluasi badge engine (sprint 12)
        { type: "json", name: "criteria", maxSize: 100000 },
      ],
      indexes: ["CREATE UNIQUE INDEX ux_badges_code ON badges (code)"],
    })

    const rewards = save({
      type: "base",
      name: "rewards", // fase 2
      listRule: '(is_active = true || ' + ADMIN + ")",
      viewRule: '(is_active = true || ' + ADMIN + ")",
      createRule: ADMIN,
      updateRule: ADMIN,
      deleteRule: ADMIN,
      fields: [
        { type: "text", name: "name", max: 150, presentable: true },
        { type: "file", name: "image", maxSelect: 1, maxSize: 2097152, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
        { type: "number", name: "points_cost", onlyInt: true, min: 0 },
        { type: "number", name: "stock", onlyInt: true, min: 0 },
        { type: "bool", name: "is_active" },
      ],
    })

    const appSettings = save({
      type: "base",
      name: "app_settings",
      // hanya superuser + hook ($app) — pengganti tabel app_settings internal
      fields: [
        { type: "text", name: "key", required: true, max: 50, presentable: true },
        { type: "json", name: "value", maxSize: 1000000 },
      ],
      indexes: ["CREATE UNIQUE INDEX ux_app_settings_key ON app_settings (key)"],
    })

    // persiapan sprint 11 (pengganti Redis cache scan) — default deny
    save({
      type: "base",
      name: "llm_cache",
      fields: [
        { type: "text", name: "key", required: true, max: 255, presentable: true },
        { type: "json", name: "value", maxSize: 2000000 },
        { type: "date", name: "expires" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX ux_llm_cache_key ON llm_cache (key)",
        "CREATE INDEX ix_llm_cache_expires ON llm_cache (expires)",
      ],
    })

    // ── e-learning (modul sebelum scans/user_missions tidak bergantung, tapi
    //    didefinisikan berurutan sesuai dependensi relasinya) ──
    const modules = save({
      type: "base",
      name: "modules",
      listRule: '(is_published = true || ' + ADMIN + ")",
      viewRule: '(is_published = true || ' + ADMIN + ")",
      createRule: ADMIN_EDITOR,
      updateRule: ADMIN_EDITOR,
      deleteRule: ADMIN_EDITOR,
      fields: [
        { type: "text", name: "title", required: true, max: 200, presentable: true },
        { type: "text", name: "slug", max: 200 },
        { type: "text", name: "description" },
        // cover_url lama: nama ikon FontAwesome atau URL gambar → field text
        { type: "text", name: "cover", max: 500 },
        { type: "number", name: "order", onlyInt: true },
        { type: "bool", name: "is_published" },
      ],
      indexes: ["CREATE UNIQUE INDEX ux_modules_slug ON modules (slug) WHERE slug != ''"],
    })

    save({
      type: "base",
      name: "lessons",
      listRule: "(module.is_published = true || " + ADMIN + ")",
      viewRule: "(module.is_published = true || " + ADMIN + ")",
      createRule: ADMIN_EDITOR,
      updateRule: ADMIN_EDITOR,
      deleteRule: ADMIN_EDITOR,
      fields: [
        rel("module", modules, { required: true, cascadeDelete: true }),
        { type: "text", name: "title", max: 200, presentable: true },
        // blok paragraph/quote/tip (satu sumber dgn editor admin)
        { type: "json", name: "content", maxSize: 2000000 },
        { type: "number", name: "order", onlyInt: true },
      ],
      indexes: ["CREATE INDEX ix_lessons_module ON lessons (module)"],
    })

    const quizzes = save({
      type: "base",
      name: "quizzes",
      listRule: "(module.is_published = true || " + ADMIN + ")",
      viewRule: "(module.is_published = true || " + ADMIN + ")",
      createRule: ADMIN_EDITOR,
      updateRule: ADMIN_EDITOR,
      deleteRule: ADMIN_EDITOR,
      fields: [rel("module", modules)],
      indexes: ["CREATE INDEX ix_quizzes_module ON quizzes (module)"],
    })

    save({
      type: "base",
      name: "quiz_questions",
      listRule: "(quiz.module.is_published = true || " + ADMIN + ")",
      viewRule: "(quiz.module.is_published = true || " + ADMIN + ")",
      createRule: ADMIN_EDITOR,
      updateRule: ADMIN_EDITOR,
      deleteRule: ADMIN_EDITOR,
      fields: [
        rel("quiz", quizzes),
        { type: "text", name: "question" },
        { type: "json", name: "options", maxSize: 100000 },
        { type: "number", name: "answer", onlyInt: true },
        { type: "text", name: "explanation" },
        { type: "number", name: "order", onlyInt: true },
      ],
      indexes: ["CREATE INDEX ix_quiz_questions_quiz ON quiz_questions (quiz)"],
    })

    // ── scan + misi ──
    const missions = save({
      type: "base",
      name: "missions",
      listRule: '(is_active = true || ' + ADMIN + ")",
      viewRule: '(is_active = true || ' + ADMIN + ")",
      createRule: ADMIN,
      updateRule: ADMIN,
      deleteRule: ADMIN,
      fields: [
        { type: "text", name: "title", required: true, max: 150, presentable: true },
        { type: "text", name: "description" },
        { type: "text", name: "type", max: 20 },
        { type: "text", name: "icon", max: 100 },
        { type: "number", name: "points", required: true, onlyInt: true, min: 1 },
        // pengganti missions.verification — alur klaim sprint 12
        { type: "select", name: "verification", required: true, maxSelect: 1, values: ["photo", "auto_scan", "manual"] },
        rel("scan_category", wasteCategories),
        { type: "number", name: "required_count", onlyInt: true, min: 1 },
        { type: "date", name: "start_at" },
        { type: "date", name: "end_at" },
        { type: "bool", name: "is_active" },
      ],
    })

    // ── data milik user ──
    save({
      type: "base",
      name: "fcm_tokens",
      listRule: OWN,
      viewRule: OWN,
      createRule: OWN,
      updateRule: OWN,
      deleteRule: OWN,
      fields: [
        rel("user", users, { required: true, cascadeDelete: true }),
        { type: "text", name: "token", required: true },
      ],
      indexes: ["CREATE UNIQUE INDEX ux_fcm_tokens_token ON fcm_tokens (token)"],
    })

    save({
      type: "base",
      name: "point_transactions",
      // ledger append-only (PRD §5.10 #1): hanya dibaca pemilik/admin —
      // penulisan eksklusif via hook ledger (sprint 11), bukan API publik.
      listRule: AUTHED + " && (user = @request.auth.id || " + ADMIN + ")",
      viewRule: AUTHED + " && (user = @request.auth.id || " + ADMIN + ")",
      fields: [
        rel("user", users, { required: true }),
        { type: "number", name: "amount", required: true, onlyInt: true },
        { type: "select", name: "source", required: true, maxSelect: 1, values: ["scan", "mission", "quiz", "streak", "redeem", "adjustment"] },
        // ref_id lama BIGINT → id record PB (string)
        { type: "text", name: "ref_id", max: 255 },
        { type: "text", name: "note" },
      ],
      indexes: ["CREATE INDEX ix_point_transactions_user ON point_transactions (user)"],
    })

    save({
      type: "base",
      name: "scans",
      listRule: OWN,
      viewRule: OWN,
      createRule: OWN,
      // immutable bagi klien — poin & llm_raw diisi hook scan (sprint 11)
      fields: [
        rel("user", users),
        { type: "file", name: "image", maxSelect: 1, maxSize: 5242880, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
        { type: "text", name: "item_name", max: 100, presentable: true },
        rel("category", wasteCategories),
        { type: "text", name: "advice" },
        { type: "json", name: "quote", maxSize: 100000 },
        // respon mentah LLM (audit & debug) — tak pernah dibaca klien
        { type: "json", name: "llm_raw", maxSize: 2000000 },
        { type: "json", name: "llm_meta", maxSize: 100000 },
        { type: "number", name: "points", onlyInt: true, min: 0 },
      ],
      indexes: ["CREATE INDEX ix_scans_user ON scans (user)"],
    })

    save({
      type: "base",
      name: "user_missions",
      listRule: AUTHED + " && (user = @request.auth.id || " + STAFF + ")",
      viewRule: AUTHED + " && (user = @request.auth.id || " + STAFF + ")",
      createRule: OWN,
      // user melengkapi klaim; verifier/admin meninjau (sprint 12 + hook transisi status)
      updateRule: AUTHED + " && (user = @request.auth.id || @request.auth.role = \"verifier\" || " + ADMIN + ")",
      fields: [
        rel("user", users, { required: true }),
        rel("mission", missions, { required: true }),
        { type: "date", name: "period_date" },
        { type: "select", name: "status", maxSelect: 1, values: ["in_progress", "submitted", "approved", "rejected"] },
        { type: "number", name: "progress_count", onlyInt: true, min: 0 },
        { type: "file", name: "proof", maxSelect: 1, maxSize: 5242880, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
        { type: "text", name: "note" },
        rel("reviewed_by", users),
        { type: "text", name: "review_note" },
        { type: "number", name: "points_awarded", onlyInt: true, min: 0 },
        // consent foto bukti tercatat server-side (PRD §9 — keputusan §2.1 #6)
        { type: "date", name: "consent_at" },
        { type: "date", name: "submitted_at" },
        { type: "date", name: "reviewed_at" },
      ],
      indexes: [
        // anti dobel klaim (PRD §5.10 #3) — partial: misi tanpa periode bebas
        "CREATE UNIQUE INDEX ux_user_missions_claim ON user_missions (user, mission, period_date) WHERE period_date != ''",
        "CREATE INDEX ix_user_missions_status ON user_missions (status)",
      ],
    })

    save({
      type: "base",
      name: "user_badges",
      // baris dibuat badge engine (sprint 12) — klien hanya membaca miliknya
      listRule: AUTHED + " && (user = @request.auth.id || " + ADMIN + ")",
      viewRule: AUTHED + " && (user = @request.auth.id || " + ADMIN + ")",
      fields: [
        rel("user", users, { required: true }),
        rel("badge", badges, { required: true }),
      ],
      indexes: ["CREATE UNIQUE INDEX ux_user_badges ON user_badges (user, badge)"],
    })

    save({
      type: "base",
      name: "user_module_progress",
      listRule: OWN,
      viewRule: OWN,
      createRule: OWN,
      updateRule: OWN,
      deleteRule: OWN,
      fields: [
        rel("user", users, { required: true }),
        rel("module", modules, { required: true }),
        { type: "number", name: "lessons_done", onlyInt: true, min: 0 },
        { type: "bool", name: "is_completed" },
        { type: "date", name: "completed_at" },
      ],
      indexes: ["CREATE UNIQUE INDEX ux_user_module_progress ON user_module_progress (user, module)"],
    })

    save({
      type: "base",
      name: "user_quiz_attempts",
      // append-only — penilaian via hook kuis (sprint 13, poin sekali per modul)
      listRule: OWN,
      viewRule: OWN,
      createRule: OWN,
      fields: [
        rel("user", users, { required: true }),
        rel("quiz", quizzes),
        { type: "number", name: "score", onlyInt: true, min: 0 },
        { type: "number", name: "total", onlyInt: true, min: 0 },
        { type: "json", name: "answers", maxSize: 100000 },
        { type: "number", name: "points_awarded", onlyInt: true, min: 0 },
        { type: "bool", name: "passed" },
        // attempted_at → field sistem `created`
      ],
      indexes: ["CREATE INDEX ix_user_quiz_attempts_user ON user_quiz_attempts (user)"],
    })

    // ── konten harian ──
    save({
      type: "base",
      name: "daily_contents",
      listRule: '(publish_date = "" || publish_date <= @now || ' + ADMIN + ")",
      viewRule: '(publish_date = "" || publish_date <= @now || ' + ADMIN + ")",
      createRule: ADMIN_EDITOR,
      updateRule: ADMIN_EDITOR,
      deleteRule: ADMIN_EDITOR,
      fields: [
        { type: "date", name: "publish_date", presentable: true },
        { type: "text", name: "type", max: 20 }, // ayat|hadis|refleksi
        { type: "text", name: "title", max: 200 },
        { type: "text", name: "body" },
        { type: "text", name: "source", max: 100 },
        { type: "text", name: "eco_action" },
        { type: "file", name: "image", maxSelect: 1, maxSize: 5242880, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
      ],
      indexes: ["CREATE UNIQUE INDEX ux_daily_contents_publish_date ON daily_contents (publish_date) WHERE publish_date != ''"],
    })

    // ── notifikasi, audit, metrik ──
    save({
      type: "base",
      name: "notifications",
      // user melihat miliknya + broadcast (user kosong); tandai-baca miliknya.
      // create/delete via hook event (sprint 13) — bukan API publik.
      listRule: AUTHED + ' && (user = @request.auth.id || user = "")',
      viewRule: AUTHED + ' && (user = @request.auth.id || user = "")',
      updateRule: OWN,
      fields: [
        rel("user", users), // kosong = broadcast
        { type: "text", name: "title", max: 200, presentable: true },
        { type: "text", name: "body" },
        { type: "text", name: "type", max: 30 }, // mission|streak|info|reward
        { type: "json", name: "payload", maxSize: 100000 },
        { type: "date", name: "read_at" },
      ],
      indexes: ["CREATE INDEX ix_notifications_user ON notifications (user)"],
    })

    save({
      type: "base",
      name: "audit_logs",
      // tulis via hook audit (sprint 10) konteks sistem; baca admin saja
      listRule: ADMIN,
      viewRule: ADMIN,
      fields: [
        rel("actor", users),
        { type: "text", name: "action", max: 50 },
        { type: "text", name: "entity", max: 30 },
        { type: "text", name: "entity_id", max: 255 },
        { type: "json", name: "diff", maxSize: 100000 },
      ],
    })

    save({
      type: "base",
      name: "analytics_events",
      // append-only via konteks sistem (hook/klien terproteksi); baca admin
      listRule: ADMIN,
      viewRule: ADMIN,
      fields: [
        rel("user", users),
        { type: "text", name: "name", required: true, max: 50, presentable: true },
        { type: "json", name: "payload", maxSize: 100000 },
      ],
      indexes: ["CREATE INDEX ix_analytics_events_name ON analytics_events (name)"],
    })

    // ── komunitas & peta (fase 2) ──
    const posts = save({
      type: "base",
      name: "posts",
      listRule: '(deleted_at = "" && (status = "published" || user = @request.auth.id || ' + ADMIN + "))",
      viewRule: '(deleted_at = "" && (status = "published" || user = @request.auth.id || ' + ADMIN + "))",
      createRule: OWN,
      updateRule: AUTHED + " && (user = @request.auth.id || " + ADMIN + ")",
      deleteRule: AUTHED + " && (user = @request.auth.id || " + ADMIN + ")", // soft delete di hook
      fields: [
        rel("user", users),
        { type: "text", name: "caption" },
        { type: "file", name: "image", maxSelect: 1, maxSize: 5242880, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
        { type: "number", name: "lat" },
        { type: "number", name: "lng" },
        { type: "number", name: "like_count", onlyInt: true, min: 0 },
        { type: "text", name: "status", max: 20 }, // published|hidden
        { type: "date", name: "deleted_at" }, // soft delete
      ],
      indexes: ["CREATE INDEX ix_posts_user ON posts (user)"],
    })

    save({
      type: "base",
      name: "post_likes",
      listRule: "",
      viewRule: "",
      createRule: OWN,
      deleteRule: OWN,
      fields: [
        rel("user", users, { required: true }),
        rel("post", posts, { required: true }),
      ],
      indexes: ["CREATE UNIQUE INDEX ux_post_likes ON post_likes (user, post)"],
    })

    save({
      type: "base",
      name: "post_comments",
      listRule: 'deleted_at = ""',
      viewRule: 'deleted_at = ""',
      createRule: OWN,
      updateRule: OWN,
      deleteRule: AUTHED + " && (user = @request.auth.id || " + ADMIN + ")",
      fields: [
        rel("post", posts),
        rel("user", users),
        { type: "text", name: "body" },
        { type: "date", name: "deleted_at" },
      ],
      indexes: ["CREATE INDEX ix_post_comments_post ON post_comments (post)"],
    })

    save({
      type: "base",
      name: "reports",
      listRule: ADMIN,
      viewRule: ADMIN,
      createRule: AUTHED + " && reporter = @request.auth.id",
      updateRule: ADMIN,
      fields: [
        rel("reporter", users),
        { type: "text", name: "target_type", max: 20 }, // post|comment|user
        { type: "text", name: "target_id", max: 255 },
        { type: "text", name: "reason" },
        { type: "text", name: "status", max: 20 }, // open|resolved
      ],
      indexes: ["CREATE INDEX ix_reports_status ON reports (status)"],
    })

    save({
      type: "base",
      name: "map_locations",
      listRule: "",
      viewRule: "",
      createRule: ADMIN,
      updateRule: ADMIN,
      deleteRule: ADMIN,
      fields: [
        { type: "text", name: "type", max: 30 }, // bank_sampah|tps|event
        { type: "text", name: "name", max: 150, presentable: true },
        { type: "text", name: "description" },
        { type: "number", name: "lat" },
        { type: "number", name: "lng" },
        { type: "text", name: "address" },
        { type: "date", name: "start_at" },
        { type: "date", name: "end_at" },
        rel("created_by", users),
        { type: "bool", name: "is_verified" },
      ],
      indexes: ["CREATE INDEX ix_map_locations_type ON map_locations (type)"],
    })

    // fase 2 — status proses reward
    save({
      type: "base",
      name: "redemptions",
      listRule: AUTHED + " && (user = @request.auth.id || " + ADMIN + ")",
      viewRule: AUTHED + " && (user = @request.auth.id || " + ADMIN + ")",
      createRule: OWN,
      updateRule: ADMIN, // proses reward oleh admin
      fields: [
        rel("user", users, { required: true }),
        rel("reward", rewards),
        { type: "number", name: "points_spent", onlyInt: true, min: 0 },
        { type: "text", name: "status", max: 20 }, // requested|processed|rejected
        rel("processed_by", users),
        { type: "date", name: "processed_at" },
      ],
      indexes: ["CREATE INDEX ix_redemptions_user ON redemptions (user)"],
    })
  },
  (app) => {
    // down — hapus dalam urutan terbalik (anak dulu, lalu orang tua).
    const names = [
      "redemptions",
      "map_locations",
      "reports",
      "post_comments",
      "post_likes",
      "posts",
      "analytics_events",
      "audit_logs",
      "notifications",
      "daily_contents",
      "user_quiz_attempts",
      "user_module_progress",
      "user_badges",
      "user_missions",
      "scans",
      "point_transactions",
      "fcm_tokens",
      "missions",
      "quiz_questions",
      "quizzes",
      "lessons",
      "modules",
      "llm_cache",
      "app_settings",
      "rewards",
      "badges",
      "levels",
      "waste_categories",
      "users",
    ]
    for (const name of names) {
      const col = app.findCollectionByNameOrId(name)
      app.delete(col)
    }
  }
)
