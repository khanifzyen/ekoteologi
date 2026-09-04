"""Seed data awal (Sprint 1, 4 & 7): waste_categories, levels, badges, missions,
modul e-learning (+ pelajaran & kuis).

Idempotent — aman dijalankan berulang; baris yang sudah ada (dicocokkan lewat
kunci naturalnya) tidak diduplikasi. Jalankan: `uv run python -m scripts.seed`.
"""

import asyncio

from sqlalchemy import func, select

from app.db.session import get_engine, get_session_factory
from app.models import (
    Badge,
    Lesson,
    Level,
    Mission,
    Module,
    Quiz,
    QuizQuestion,
    WasteCategory,
)
from app.services.elearning import normalize_blocks

CATEGORIES: list[dict] = [
    {"name": "Organik", "icon": "fa-apple-whole", "base_points": 5},
    {"name": "Plastik", "icon": "fa-bottle-water", "base_points": 5},
    {"name": "Kertas", "icon": "fa-newspaper", "base_points": 4},
    {"name": "Kaca", "icon": "fa-wine-bottle", "base_points": 4},
    {"name": "Logam", "icon": "fa-magnet", "base_points": 5},
    {"name": "B3", "icon": "fa-biohazard", "base_points": 10},
    {"name": "Residu", "icon": "fa-trash-can", "base_points": 2},
]

# Ladder 10 level; title tampil di pill header (beranda) & kartu profil.
LEVELS: list[dict] = [
    {"level": 1, "min_points": 0, "title": "Pemula"},
    {"level": 2, "min_points": 50, "title": "Penjaga Kecil"},
    {"level": 3, "min_points": 150, "title": "Sahabat Bumi"},
    {"level": 4, "min_points": 300, "title": "Pejuang Hijau"},
    {"level": 5, "min_points": 500, "title": "Aktivis Lingkungan"},
    {"level": 6, "min_points": 750, "title": "Kader Hijau"},
    {"level": 7, "min_points": 1050, "title": "Penjaga Amanah"},
    {"level": 8, "min_points": 1400, "title": "Panglima Ekologi"},
    {"level": 9, "min_points": 1800, "title": "Khalifah Bumi"},
    {"level": 10, "min_points": 2300, "title": "Teladan Ekoteologi"},
]

# `criteria` dievaluasi badge engine (Sprint 6): {"type", "value"}.
BADGES: list[dict] = [
    {
        "code": "scan_pertama",
        "name": "Langkah Kecil",
        "icon": "fa-camera",
        "description": "Selesaikan scan sampah pertamamu.",
        "criteria": {"type": "scan_count", "value": 1},
    },
    {
        "code": "scan_10",
        "name": "Kolektor Muda",
        "icon": "fa-recycle",
        "description": "Selesaikan 10 scan sampah.",
        "criteria": {"type": "scan_count", "value": 10},
    },
    {
        "code": "scan_50",
        "name": "Ahli Memilah",
        "icon": "fa-boxes-stacked",
        "description": "Selesaikan 50 scan sampah.",
        "criteria": {"type": "scan_count", "value": 50},
    },
    {
        "code": "scan_100",
        "name": "Master Daur Ulang",
        "icon": "fa-award",
        "description": "Selesaikan 100 scan sampah.",
        "criteria": {"type": "scan_count", "value": 100},
    },
    {
        "code": "streak_7",
        "name": "Seminggu Konsisten",
        "icon": "fa-fire",
        "description": "Jaga streak aktif 7 hari berturut-turut.",
        "criteria": {"type": "streak", "value": 7},
    },
    {
        "code": "streak_30",
        "name": "Sebulan Berkah",
        "icon": "fa-calendar-check",
        "description": "Jaga streak aktif 30 hari berturut-turut.",
        "criteria": {"type": "streak", "value": 30},
    },
    {
        "code": "misi_pertama",
        "name": "Misi Pertama",
        "icon": "fa-bullseye",
        "description": "Selesaikan satu misi apa pun.",
        "criteria": {"type": "mission_done", "value": 1},
    },
    {
        "code": "misi_25",
        "name": "Aktivis Misi",
        "icon": "fa-list-check",
        "description": "Selesaikan 25 misi.",
        "criteria": {"type": "mission_done", "value": 25},
    },
    {
        "code": "kuis_10",
        "name": "Cendekiawan Hijau",
        "icon": "fa-graduation-cap",
        "description": "Lulus 10 kuis modul belajar.",
        "criteria": {"type": "quiz_passed", "value": 10},
    },
    {
        "code": "poin_1000",
        "name": "Seribu Kebaikan",
        "icon": "fa-coins",
        "description": "Kumpulkan total 1.000 poin.",
        "criteria": {"type": "points_earned", "value": 1000},
    },
]

# Misi contoh (Sprint 4) — dibuat admin lewat CRUD, seed hanya memberi contoh
# awal agar alur mobile→antrian bisa didemokan tanpa isi data manual. Tanpa
# jendela waktu (start/end None) → selalu aktif; periodisasi harian/mingguan
# dihitung server (services.missions).
MISSIONS: list[dict] = [
    {
        "title": "Scan 3 Jenis Sampah",
        "description": "Gunakan scan AI untuk mengenali 3 jenis sampah berbeda hari ini.",
        "type": "daily",
        "icon": "fa-camera",
        "points": 15,
        "verification": "auto_scan",
        "required_count": 3,
    },
    {
        "title": "Setor 1 kg Plastik ke Bank Sampah",
        "description": "Unggah foto bukti penyerahan sampahmu. Verifikasi admin maks. 1×24 jam.",
        "type": "daily",
        "icon": "fa-recycle",
        "points": 50,
        "verification": "photo",
    },
    {
        "title": "Pilah Sampah Rumah Tangga",
        "description": "Unggah foto hasil pilah organik & anorganik di rumahmu.",
        "type": "daily",
        "icon": "fa-trash-can",
        "points": 20,
        "verification": "photo",
    },
    {
        "title": "Bersihkan Wudhu, Hemat Air",
        "description": "Gunakan air secukupnya saat wudhu hari ini — cukup klaim jujur.",
        "type": "daily",
        "icon": "fa-hands-bubbles",
        "points": 10,
        "verification": "manual",
    },
    {
        "title": 'Baca Refleksi "Bumi sebagai Amanah"',
        "description": "Selesaikan refleksi harian di menu Belajar.",
        "type": "daily",
        "icon": "fa-mosque",
        "points": 5,
        "verification": "manual",
    },
]


# Modul e-learning contoh (Sprint 7) — mengikuti mockup `elearning.html` agar
# demo belajar → kuis → poin jalan end-to-end tanpa isi data manual. `cover_url`
# memuat nama ikon FontAwesome (mobile merender sebagai ikon; URL gambar juga
# didukung — lihat util `coverIcon` sisi klien). Blok konten tervalidasi
# `normalize_blocks` (bentuk sama dgn editor admin). Kuis & soal opsional per modul.
MODULES: list[dict] = [
    {
        "title": "Eko-Iman: Dasar Ekoteologi",
        "slug": "eko-iman-dasar-ekoteologi",
        "description": "Mengenal hubungan iman dan tanggung jawab lingkungan.",
        "cover_url": "fa-leaf",
        "order": 1,
        "is_published": True,
        "lessons": [
            {
                "title": "Bumi adalah Amanah",
                "content": normalize_blocks(
                    [
                        {
                            "type": "paragraph",
                            "text": (
                                "Dalam pandangan ekoteologi, bumi bukan milik manusia "
                                "untuk dieksploitasi — ia amanah yang dipinjamkan. "
                                "Menjaganya adalah bagian dari iman, bukan sekadar "
                                "gaya hidup ramah lingkungan."
                            ),
                        },
                        {
                            "type": "quote",
                            "arabic": "وَلَا تُفْسِدُوا فِي الْأَرْضِ بَعْدَ إِصْلَاحِهَا",
                            "text": (
                                '"Dan janganlah kamu berbuat kerusakan di bumi setelah '
                                'Allah memperbaikinya."'
                            ),
                            "source": "QS. Al-A'raf: 56",
                        },
                        {
                            "type": "tip",
                            "text": (
                                "Mulai dari yang kecil: matikan lampu saat keluar ruangan — "
                                "hemat energi juga menjaga amanah."
                            ),
                        },
                    ]
                ),
            },
            {
                "title": "Khalifah yang Bertanggung Jawab",
                "content": normalize_blocks(
                    [
                        {
                            "type": "paragraph",
                            "text": (
                                "Manusia diangkat sebagai khalifah di bumi — bukan pemilik "
                                "tunggal, melainkan pengelola yang akan dimintai pertanggung-"
                                "jawaban. Karena itu merusak lingkungan berarti mengkhianati "
                                "kepercayaan itu."
                            ),
                        },
                        {
                            "type": "quote",
                            "arabic": "إِنَّ الْإِنْسَانَ لِرَبِّهِ لَمَكْلُوبٌ",
                            "text": '"Sesungguhnya manusia benar-benar dalam pengawasan Tuhannya."',
                            "source": "QS. Al-'Insyirah: 6",
                        },
                    ]
                ),
            },
        ],
        "quiz": {
            "questions": [
                {
                    "question": "Apa makna bumi dalam pandangan ekoteologi?",
                    "options": [
                        "Milik manusia untuk dieksploitasi penuh",
                        "Amanah yang dikelola dan dijaga",
                        "Tempat sementara tanpa tanggung jawab",
                    ],
                    "answer": 1,
                    "explanation": "Bumi adalah amanah — manusia pengelola, bukan pemilik bebas.",
                },
                {
                    "question": "Apa pesan utama QS. Al-A'raf ayat 56 tentang bumi?",
                    "options": [
                        "Jangan berbuat kerusakan di bumi",
                        "Kerjakan pertanian sebanyak-banyaknya",
                        "Tinggalkan perkotaan",
                    ],
                    "answer": 0,
                    "explanation": "Ayat itu memerintahkan tidak berbuat kerusakan di bumi.",
                },
                {
                    "question": "Sikap khalifah yang benar terhadap lingkungan adalah…",
                    "options": [
                        "Mengelola dengan tanggung jawab",
                        "Memanfaatkan tanpa batas",
                        "Membiarkan orang lain mengurus",
                    ],
                    "answer": 0,
                    "explanation": "Khalifah adalah pengelola yang bertanggung jawab.",
                },
            ]
        },
    },
    {
        "title": "Fiqih Sampah Sehari-hari",
        "slug": "fiqih-sampah-sehari-hari",
        "description": "Hukum memilah sampah, dhuha air bekas wudhu, dan praktik harian.",
        "cover_url": "fa-recycle",
        "order": 2,
        "is_published": True,
        "lessons": [
            {
                "title": "Hukum Memilah Sampah dalam Islam",
                "content": normalize_blocks(
                    [
                        {
                            "type": "paragraph",
                            "text": (
                                "Memilah sampah termasuk fardhu kifayah di lingkungan bersama: "
                                "bila sebagian sudah melakukannya, kewajiban gugur bagi yang "
                                "lain — namun pahala bagi yang berinisiatif. Di rumah sendiri, "
                                "memilah adalah bagian dari menjaga kebersihan yang dianjurkan."
                            ),
                        },
                        {
                            "type": "quote",
                            "arabic": "وَلَا تُفْسِدُوا فِي الْأَرْضِ بَعْدَ إِصْلَاحِهَا",
                            "text": (
                                '"Dan janganlah kamu berbuat kerusakan di bumi setelah '
                                'Allah memperbaikinya."'
                            ),
                            "source": "QS. Al-A'raf: 56",
                        },
                        {
                            "type": "tip",
                            "text": (
                                "Sedotan plastik butuh ±200 tahun untuk terurai. Bawa tumbler "
                                "dan sedotan stainless saat bepergian."
                            ),
                        },
                    ]
                ),
            },
            {
                "title": "Air Bekas Wudhu Bermanfaat",
                "content": normalize_blocks(
                    [
                        {
                            "type": "paragraph",
                            "text": (
                                "Air bekas wudhu hukumnya suci dan boleh dimanfaatkan — misalnya "
                                "untuk menyiram tanaman. Nabi mengingatkan agar tidak boros air "
                                "bahkan saat berwudhu di sungai yang mengalir."
                            ),
                        },
                        {
                            "type": "tip",
                            "text": (
                                "Sediakan ember khusus di kamar mandi "
                                "untuk menampung air bekas wudhu."
                            ),
                        },
                    ]
                ),
            },
        ],
        "quiz": {
            "questions": [
                {
                    "question": "Sampah plastik termasuk kategori…",
                    "options": [
                        "Organik — mudah terurai",
                        "Anorganik — perlu dipilah khusus",
                        "B3 — berbahaya bagi kesehatan",
                    ],
                    "answer": 1,
                    "explanation": (
                        "Plastik adalah anorganik: tak terurai, wajib dipilah untuk didaur."
                    ),
                },
                {
                    "question": "Hukum memilah sampah di lingkungan bersama termasuk…",
                    "options": ["Fardhu kifayah", "Sunnah muakkadah", "Mubah sahaja"],
                    "answer": 0,
                    "explanation": (
                        "Menjaga lingkungan bersama adalah kewajiban kolektif (fardhu kifayah)."
                    ),
                },
                {
                    "question": "Air bekas wudhu sebaiknya…",
                    "options": [
                        "Dibuang begitu saja",
                        "Dimanfaatkan misalnya untuk menyiram tanaman",
                        "Dibiarkan menggenang",
                    ],
                    "answer": 1,
                    "explanation": "Air bekas wudhu suci dan bermanfaat — boros air dilarang.",
                },
                {
                    "question": "Berapa lama sedotan plastik umumnya terurai?",
                    "options": ["±2 tahun", "±20 tahun", "±200 tahun"],
                    "answer": 2,
                    "explanation": "Sedotan plastik butuh ±200 tahun untuk terurai.",
                },
            ]
        },
    },
    {
        "title": "Hemat Air, Amal Terjaga",
        "slug": "hemat-air-amal-terjaga",
        "description": "Adab menggunakan air, wudhu hemat, dan kisah Nabi di Padangpasir.",
        "cover_url": "fa-droplet",
        "order": 3,
        "is_published": True,
        "lessons": [
            {
                "title": "Wudhu Hemat ala Nabi",
                "content": normalize_blocks(
                    [
                        {
                            "type": "paragraph",
                            "text": (
                                "Nabi berwudhu dengan air sekitar satu mud (±0,75 liter) — "
                                "jauh lebih sedikit dari kebiasaan kita. Wudhu hemat adalah "
                                "sunnah yang sering terlewat."
                            ),
                        },
                        {
                            "type": "tip",
                            "text": "Tutup keran saat menggosok — buka hanya saat membilas.",
                        },
                    ]
                ),
            },
            {
                "title": "Kisah di Padangpasir",
                "content": normalize_blocks(
                    [
                        {
                            "type": "paragraph",
                            "text": (
                                "Seorang sahabat melihat Nabi berwudhu di Padangpasir dan "
                                "hampir menegur karena air seberapa pun berharga di sana — "
                                "pelajaran bahwa hemat berlaku bahkan saat air melimpah."
                            ),
                        },
                        {
                            "type": "quote",
                            "text": (
                                '"Janganlah boros air meskipun engkau '
                                'berwudhu di sungai yang mengalir."'
                            ),
                            "source": "HR. Ibnu Majah",
                        },
                    ]
                ),
            },
        ],
        "quiz": {
            "questions": [
                {
                    "question": "Berapa perkiraan air wudhu Nabi?",
                    "options": ["±0,75 liter (satu mud)", "±5 liter", "±10 liter"],
                    "answer": 0,
                    "explanation": "Nabi berwudhu dengan air sekitar satu mud (±0,75 liter).",
                },
                {
                    "question": "Perintah hemat air berlaku…",
                    "options": [
                        "Hanya saat kekeringan",
                        "Bahkan saat air melimpah",
                        "Hanya di Padangpasir",
                    ],
                    "answer": 1,
                    "explanation": "Hemat berlaku selalu — bahkan di sungai yang mengalir.",
                },
            ]
        },
    },
]


async def seed_modules(db) -> None:
    """Seed modul + pelajaran + kuis (idempoten per slug / judul pelajaran)."""
    for spec in MODULES:
        module = (await db.scalars(select(Module).where(Module.slug == spec["slug"]))).first()
        if module is None:
            module = Module(
                title=spec["title"],
                slug=spec["slug"],
                description=spec["description"],
                cover_url=spec["cover_url"],
                order=spec["order"],
                is_published=spec["is_published"],
            )
            db.add(module)
            await db.flush()

        for lesson_spec in spec["lessons"]:
            exists = (
                await db.scalars(
                    select(Lesson).where(
                        Lesson.module_id == module.id,
                        Lesson.title == lesson_spec["title"],
                    )
                )
            ).first()
            if exists is None:
                db.add(
                    Lesson(
                        module_id=module.id,
                        title=lesson_spec["title"],
                        content=lesson_spec["content"],
                        order=spec["lessons"].index(lesson_spec),
                    )
                )

        quiz_spec = spec.get("quiz")
        if quiz_spec:
            quiz = (await db.scalars(select(Quiz).where(Quiz.module_id == module.id))).first()
            if quiz is None:
                quiz = Quiz(module_id=module.id)
                db.add(quiz)
                await db.flush()
            for i, q_spec in enumerate(quiz_spec["questions"]):
                exists = (
                    await db.scalars(
                        select(QuizQuestion).where(
                            QuizQuestion.quiz_id == quiz.id,
                            QuizQuestion.question == q_spec["question"],
                        )
                    )
                ).first()
                if exists is None:
                    db.add(
                        QuizQuestion(
                            quiz_id=quiz.id,
                            question=q_spec["question"],
                            options=q_spec["options"],
                            answer=q_spec["answer"],
                            explanation=q_spec.get("explanation"),
                            order=i,
                        )
                    )


async def seed() -> dict[str, int]:
    """Isi tabel seed. Kembalikan jumlah baris per tabel setelah seeding."""
    async with get_session_factory()() as db:
        for cat in CATEGORIES:
            exists = (
                await db.scalars(select(WasteCategory).where(WasteCategory.name == cat["name"]))
            ).first()
            if exists is None:
                db.add(WasteCategory(**cat))

        for lvl in LEVELS:
            exists = await db.get(Level, lvl["level"])
            if exists is None:
                db.add(Level(**lvl))

        for badge in BADGES:
            exists = (await db.scalars(select(Badge).where(Badge.code == badge["code"]))).first()
            if exists is None:
                db.add(Badge(**badge))

        for mission in MISSIONS:
            exists = (
                await db.scalars(select(Mission).where(Mission.title == mission["title"]))
            ).first()
            if exists is None:
                db.add(Mission(**mission))

        await seed_modules(db)

        await db.commit()

        return {
            "waste_categories": (
                await db.scalar(select(func.count()).select_from(WasteCategory)) or 0
            ),
            "levels": await db.scalar(select(func.count()).select_from(Level)) or 0,
            "badges": await db.scalar(select(func.count()).select_from(Badge)) or 0,
            "missions": await db.scalar(select(func.count()).select_from(Mission)) or 0,
            "modules": await db.scalar(select(func.count()).select_from(Module)) or 0,
            "lessons": await db.scalar(select(func.count()).select_from(Lesson)) or 0,
            "quiz_questions": (
                await db.scalar(select(func.count()).select_from(QuizQuestion)) or 0
            ),
        }


async def main() -> None:
    counts = await seed()
    print("Seed selesai:")
    for table, count in counts.items():
        print(f"  - {table}: {count} baris")


if __name__ == "__main__":
    engine = get_engine()

    async def _run() -> None:
        try:
            await main()
        finally:
            await engine.dispose()

    asyncio.run(_run())
