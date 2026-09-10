/// <reference path="../pb_data/types.d.ts" />
/**
 * Sprint 12 — Misi, Verifikasi & Gamifikasi (bootstrap skema & rules).
 *
 *   1. Field `users.level` + `users.level_title` — cache posisi level yang
 *      dihitung ulang oleh hook ledger setiap `users.points` berubah
 *      (paritas "level tidak disimpan, dihitung dari levels.min_points" —
 *      versi PB menyimpan HASIL hitung agar klien/profil tak perlu menyeberang
 *      koleksi; sumber kebenaran tetap tangga `levels`).
 *   2. Kunci `user_missions` dari API tulis klien:
 *      - createRule → null (klaim hanya lahir lewat route hook
 *        POST /api/ekoteologi/missions/{id}/claim — periode, consent, status,
 *        dan auto-approve manual dihitung server; klien tak bisa memilih
 *        status/points_awarded sendiri);
 *      - updateRule → staff (verifier/admin) saja — keputusan review lewat
 *        PATCH koleksi, engine side-effect (ledger+notif+streak+badge) hidup
 *        di hook model; pemilik klaim tidak pernah PATCH (klaim ulang setelah
 *        ditolak juga lewat route).
 *      Paritas FastAPI: endpoint klaim & review server-side (api/missions.py,
 *      api/admin_verification.py).
 *   3. Backfill level utk user yang sudah ada (instance dev/staging).
 *
 * Down: hapus kedua field, kembalikan rules semula (sprint 9).
 */

migrate(
  (app) => {
    // ── 1. field level pada users (pola fields.add — temuan v0.40 sprint 10:
    //      push objek polos ke col.fields gagal konversi Go) ──
    const users = app.findCollectionByNameOrId("users")
    if (!(users.fields.getByName && users.fields.getByName("level"))) {
      users.fields.add(new NumberField({ name: "level", onlyInt: true, min: 1 }))
    }
    if (!(users.fields.getByName && users.fields.getByName("level_title"))) {
      users.fields.add(new TextField({ name: "level_title", max: 50 }))
    }
    app.save(users)

    // ── 2. rules user_missions ──
    const um = app.findCollectionByNameOrId("user_missions")
    um.createRule = null // hanya superuser + route hook (konteks internal)
    um.updateRule =
      '(@request.auth.role = "verifier" || @request.auth.role = "admin")'
    app.save(um)

    // ── 3. backfill level existing users (idempoten) ──
    const ladder = app.findRecordsByFilter("levels", "id != ''", "min_points", 0, 0) || []
    const allUsers = app.findRecordsByFilter("users", "id != ''", "", 0, 0) || []
    let updated = 0
    for (let i = 0; i < allUsers.length; i++) {
      const user = allUsers[i]
      const points = user.get("points") || 0
      let level = 1
      let title = "Pemula"
      for (let j = 0; j < ladder.length; j++) {
        const min = ladder[j].get("min_points") || 0
        if (min <= points && (ladder[j].get("level") || 1) >= level) {
          level = ladder[j].get("level") || 1
          title = ladder[j].get("title") || "Pemula"
        }
      }
      if (user.get("level") !== level || user.get("level_title") !== title) {
        user.set("level", level)
        user.set("level_title", title)
        app.save(user)
        updated++
      }
    }
    console.log(
      "[sprint12] gamification bootstrap: users.level/level_title ditambahkan, rules user_missions dikunci, backfill level " +
        updated + " user (ladder " + ladder.length + ")"
    )
  },
  (app) => {
    // down — kembalikan rules sprint 9 & lepaskan field level.
    const um = app.findCollectionByNameOrId("user_missions")
    um.createRule = '@request.auth.id != "" && user = @request.auth.id'
    um.updateRule =
      '@request.auth.id != "" && (user = @request.auth.id || @request.auth.role = "verifier" || @request.auth.role = "admin")'
    app.save(um)

    const users = app.findCollectionByNameOrId("users")
    const fields = users.fields
    const levelField = fields.getByName ? fields.getByName("level") : null
    if (levelField) fields.removeByName("level")
    const titleField = fields.getByName ? fields.getByName("level_title") : null
    if (titleField) fields.removeByName("level_title")
    app.save(users)
  }
)
