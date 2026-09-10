/// <reference path="../pb_data/types.d.ts" />
/**
 * Sprint 9 — seed data awal (pengganti api/scripts/seed.py): waste_categories,
 * levels, badges. Idempoten — setiap baris dicocokkan lewat kunci naturalnya
 * (name/level/code) dan dilewati bila sudah ada, sehingga aman dijalankan
 * berulang / di instance yang sudah berisi data.
 *
 * Misi contoh & modul e-learning sengaja TIDAK di-seed di sini — CRUD-nya jadi
 * bagian port misi (sprint 12) & e-learning (sprint 13).
 */

migrate(
  (app) => {
    // Port dari scripts/seed.py CATEGORIES
    const CATEGORIES = [
      { name: "Organik", icon: "fa-apple-whole", base_points: 5 },
      { name: "Plastik", icon: "fa-bottle-water", base_points: 5 },
      { name: "Kertas", icon: "fa-newspaper", base_points: 4 },
      { name: "Kaca", icon: "fa-wine-bottle", base_points: 4 },
      { name: "Logam", icon: "fa-magnet", base_points: 5 },
      { name: "B3", icon: "fa-biohazard", base_points: 10 },
      { name: "Residu", icon: "fa-trash-can", base_points: 2 },
    ]

    // Ladder 10 level — title tampil di pill header (beranda) & kartu profil
    const LEVELS = [
      { level: 1, min_points: 0, title: "Pemula" },
      { level: 2, min_points: 50, title: "Penjaga Kecil" },
      { level: 3, min_points: 150, title: "Sahabat Bumi" },
      { level: 4, min_points: 300, title: "Pejuang Hijau" },
      { level: 5, min_points: 500, title: "Aktivis Lingkungan" },
      { level: 6, min_points: 750, title: "Kader Hijau" },
      { level: 7, min_points: 1050, title: "Penjaga Amanah" },
      { level: 8, min_points: 1400, title: "Panglima Ekologi" },
      { level: 9, min_points: 1800, title: "Khalifah Bumi" },
      { level: 10, min_points: 2300, title: "Teladan Ekoteologi" },
    ]

    // criteria dievaluasi badge engine (sprint 12): {"type", "value"}
    const BADGES = [
      { code: "scan_pertama", name: "Langkah Kecil", icon: "fa-camera", description: "Selesaikan scan sampah pertamamu.", criteria: { type: "scan_count", value: 1 } },
      { code: "scan_10", name: "Kolektor Muda", icon: "fa-recycle", description: "Selesaikan 10 scan sampah.", criteria: { type: "scan_count", value: 10 } },
      { code: "scan_50", name: "Ahli Memilah", icon: "fa-boxes-stacked", description: "Selesaikan 50 scan sampah.", criteria: { type: "scan_count", value: 50 } },
      { code: "scan_100", name: "Master Daur Ulang", icon: "fa-award", description: "Selesaikan 100 scan sampah.", criteria: { type: "scan_count", value: 100 } },
      { code: "streak_7", name: "Seminggu Konsisten", icon: "fa-fire", description: "Jaga streak aktif 7 hari berturut-turut.", criteria: { type: "streak", value: 7 } },
      { code: "streak_30", name: "Sebulan Berkah", icon: "fa-calendar-check", description: "Jaga streak aktif 30 hari berturut-turut.", criteria: { type: "streak", value: 30 } },
      { code: "misi_pertama", name: "Misi Pertama", icon: "fa-bullseye", description: "Selesaikan satu misi apa pun.", criteria: { type: "mission_done", value: 1 } },
      { code: "misi_25", name: "Aktivis Misi", icon: "fa-list-check", description: "Selesaikan 25 misi.", criteria: { type: "mission_done", value: 25 } },
      { code: "kuis_10", name: "Cendekiawan Hijau", icon: "fa-graduation-cap", description: "Lulus 10 kuis modul belajar.", criteria: { type: "quiz_passed", value: 10 } },
      { code: "poin_1000", name: "Seribu Kebaikan", icon: "fa-coins", description: "Kumpulkan total 1.000 poin.", criteria: { type: "points_earned", value: 1000 } },
    ]

    function seedIfMissing(collection, filter, params, data) {
      // Idempoten: cocokkan lewat kunci natural sebelum menyisipkan.
      // findFirstRecordByFilter melempar error bila tidak ada baris cocok.
      let existing = null
      try {
        existing = app.findFirstRecordByFilter(collection, filter, params)
      } catch (e) {
        existing = null
      }
      if (existing) {
        return false
      }
      const col = app.findCollectionByNameOrId(collection)
      const record = new Record(col)
      record.load(data)
      app.save(record)
      return true
    }

    let created = 0
    for (const cat of CATEGORIES) {
      if (seedIfMissing("waste_categories", "name = {:name}", { name: cat.name }, cat)) created++
    }
    for (const lvl of LEVELS) {
      if (seedIfMissing("levels", "level = {:level}", { level: lvl.level }, lvl)) created++
    }
    for (const badge of BADGES) {
      if (seedIfMissing("badges", "code = {:code}", { code: badge.code }, badge)) created++
    }
    console.log(
      "[seed] waste_categories=" + CATEGORIES.length + " levels=" + LEVELS.length +
        " badges=" + BADGES.length + " (baru dibuat: " + created + ")"
    )
  },
  (app) => {
    // down — hapus baris seed berdasarkan kunci natural (idempoten juga saat revert).
    const KEYS = {
      waste_categories: ["Organik", "Plastik", "Kertas", "Kaca", "Logam", "B3", "Residu"],
      levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      badges: [
        "scan_pertama", "scan_10", "scan_50", "scan_100", "streak_7",
        "streak_30", "misi_pertama", "misi_25", "kuis_10", "poin_1000",
      ],
    }
    for (const [collection, keys] of Object.entries(KEYS)) {
      for (const key of keys) {
        const filter = collection === "levels" ? "level = {:k}" : collection === "badges" ? "code = {:k}" : "name = {:k}"
        const rec = app.findFirstRecordByFilter(collection, filter, { k: key })
        if (rec) app.delete(rec)
      }
    }
  }
)
