/// <reference path="../pb_data/types.d.ts" />
/**
 * Sprint 13 — E-Learning, Notifikasi, QA & Rilis.
 *
 * Kunci jalur tulis yang kini dilayani route hook (paritas keamanan scans
 * sprint 11 & user_missions sprint 12 — penilaian/progres tidak bisa
 * dipalsukan klien):
 *
 * 1. `user_quiz_attempts` — createRule dihapus: attempt kuis hanya lahir dari
 *    hook penilaian `POST /api/ekoteologi/modules/{id}/quiz` (kunci jawaban
 *    tidak pernah ke klien; poin sekali per modul via ledger). Read tetap OWN.
 *    Tanpa ini user bisa menulis attempt `passed=true` lewat API dan
 *    memanen lencana kuis (`quiz_passed`) tanpa mengerjakan kuis.
 * 2. `user_module_progress` — create/update/delete rule dihapus: progres
 *    pelajaran berurutan dihitung server oleh route
 *    `POST /api/ekoteologi/lessons/{id}/complete` (transisi `modul_selesai`
 *    — event/streak/badge — ikut route). Read tetap OWN.
 *
 * Koleksi `quizzes`/`quiz_questions` ikut ditutup dari baca publik (rule
 * ADMIN_EDITOR) — kunci jawaban kini HANYA keluar lewat route kuis
 * (soal tanpa kunci; review penuh sesudah submit), menggantikan
 * client-grading yang membocorkan `answer`/`explanation`.
 *
 * Backup otomatis `pb_data`: fitur bawaan PocketBase diaktifkan dari env —
 * `BACKUP_CRON` (default "0 2 * * *", kosongkan utk mematikan) dengan
 * retensi `BACKUP_KEEP` arsip cron (default 7; bawaan PB menghapus arsip
 * lama sendiri). Cadangan manual kapan pun: route
 * `POST /api/ekoteologi/cron/backup` (admin) — hasilnya tampil di
 * `/api/backups` (superuser) dan dasbor PB.
 */
migrate(
  (app) => {
    const ADMIN_EDITOR = '(@request.auth.role = "admin" || @request.auth.role = "editor")'

    function setRules(name, rules) {
      const col = app.findCollectionByNameOrId(name)
      col.listRule = rules.list !== undefined ? rules.list : col.listRule
      col.viewRule = rules.view !== undefined ? rules.view : col.viewRule
      col.createRule = rules["create"] !== undefined ? rules["create"] : col.createRule
      col.updateRule = rules["update"] !== undefined ? rules["update"] : col.updateRule
      col.deleteRule = rules["delete"] !== undefined ? rules["delete"] : col.deleteRule
      app.save(col)
    }

    setRules("user_quiz_attempts", { "create": null })
    setRules("user_module_progress", { "create": null, "update": null, "delete": null })
    setRules("quizzes", { list: ADMIN_EDITOR, view: ADMIN_EDITOR })
    setRules("quiz_questions", { list: ADMIN_EDITOR, view: ADMIN_EDITOR })

    // Backup otomatis bawaan PB (env-driven saat migrasi berjalan).
    // BACKUP_ENABLED=0 mematikan; BACKUP_CRON kosong = default "0 2 * * *".
    const settings = app.settings()
    if (($os.getenv("BACKUP_ENABLED") || "1") === "0") {
      settings.backups.cron = ""
    } else {
      settings.backups.cron = $os.getenv("BACKUP_CRON") || "0 2 * * *"
    }
    const keep = parseInt($os.getenv("BACKUP_KEEP") || "7", 10)
    settings.backups.cronMaxKeep = isNaN(keep) || keep < 1 ? 7 : keep
    app.save(settings)
  },
  (app) => {
    // down — kembalikan perilaku sprint 9 (kuis dinilai klien).
    const AUTHED = '@request.auth.id != ""'
    const OWN = AUTHED + " && user = @request.auth.id"
    const ADMIN = '@request.auth.role = "admin"'
    const MOD_PUB = "(module.is_published = true || " + ADMIN + ")"

    function setRules(name, rules) {
      const col = app.findCollectionByNameOrId(name)
      col.createRule = rules["create"]
      col.updateRule = rules["update"]
      col.deleteRule = rules["delete"]
      col.listRule = rules.list
      col.viewRule = rules.view
      app.save(col)
    }
    setRules("user_quiz_attempts", { "create": OWN, "update": null, "delete": null, "list": OWN, "view": OWN })
    setRules("user_module_progress", {
      "create": OWN, "update": OWN, "delete": OWN, "list": OWN, "view": OWN,
    })
    setRules("quizzes", { "list": MOD_PUB, "view": MOD_PUB, "create": null, "update": null, "delete": null })
    setRules("quiz_questions", { "list": MOD_PUB, "view": MOD_PUB, "create": null, "update": null, "delete": null })

    // matikan lagi backup otomatis bawaan PB
    const settings = app.settings()
    settings.backups.cron = ""
    app.save(settings)
  }
)
