"""Test e-learning (Sprint 7) — logika bisnis + endpoint user & admin.

- Murni: normalize_blocks, next_lessons_done, progress_percent, module_cta,
  grade_quiz + with_threshold (penilaian otomatis), quiz_result_message.
- Integrasi: daftar modul + progres, selesaikan pelajaran (transisi modul
  selesai → event + streak), kuis lulus → poin sekali per modul (anti dobel),
  gagal → tanpa poin, badge engine, CRUD admin (modul/pelajaran/soal).
"""

import pytest
from sqlalchemy import func, select

from app.models import (
    AnalyticsEvent,
    Lesson,
    Module,
    PointTransaction,
    Quiz,
    QuizQuestion,
    UserModuleProgress,
    UserQuizAttempt,
)
from app.services.elearning import (
    block_label,
    grade_quiz,
    module_cta,
    next_lessons_done,
    normalize_blocks,
    progress_percent,
    quiz_result_message,
    with_threshold,
)
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASS_PERCENT = 70
QUIZ_POINTS = 20


# ═══ Fungsi murni ═══


def test_normalize_blocks_sah():
    blocks = normalize_blocks(
        [
            {"type": "paragraph", "text": "  Memilah sampah itu wajib.  "},
            {
                "type": "quote",
                "text": '"Jangan berbuat kerusakan di bumi."',
                "arabic": "وَلَا تُفْسِدُوا",
                "source": "QS. Al-A'raf: 56",
            },
            {"type": "tip", "text": "Bawa tumbler."},
        ]
    )
    assert [b["type"] for b in blocks] == ["paragraph", "quote", "tip"]
    assert blocks[0]["text"] == "Memilah sampah itu wajib."
    assert blocks[1]["arabic"] == "وَلَا تُفْسِدُوا"
    assert "arabic" not in blocks[2]


def test_normalize_blocks_menolak_tipe_asing_dan_teks_kosong():
    with pytest.raises(ValueError, match="tipe"):
        normalize_blocks([{"type": "video", "text": "x"}])
    with pytest.raises(ValueError, match="teks"):
        normalize_blocks([{"type": "paragraph", "text": "   "}])
    with pytest.raises(ValueError, match="minimal satu blok"):
        normalize_blocks([])


def test_next_lessons_done_sequential_dan_idempoten():
    assert next_lessons_done(0, 0) == 1
    assert next_lessons_done(1, 1) == 2
    # Membaca ulang pelajaran lama tidak menurunkan progres.
    assert next_lessons_done(3, 0) == 3


def test_progress_percent_batas():
    assert progress_percent(0, 4) == 0
    assert progress_percent(2, 4) == 50
    assert progress_percent(4, 4) == 100
    assert progress_percent(5, 4) == 100  # tidak pernah lebih
    assert progress_percent(1, 0) == 0


def test_module_cta_mockup():
    assert module_cta(total_lessons=3, lessons_done=0) == "Mulai"
    assert module_cta(total_lessons=3, lessons_done=1) == "Lanjutkan"
    assert module_cta(total_lessons=3, lessons_done=3) == "Ulangi"
    assert module_cta(total_lessons=0, lessons_done=0) == "Mulai"


def test_grade_quiz_penilaian_otomatis():
    questions = [
        (1, "Q1", 1, "penjelasan 1"),
        (2, "Q2", 0, None),
        (3, "Q3", 2, "penjelasan 3"),
    ]
    graded = grade_quiz(questions, {1: 1, 2: 1, 3: 0})
    assert graded.score == 1
    assert graded.total == 3
    assert graded.percent == 33
    items = {i.question_id: i for i in graded.items}
    assert items[1].correct is True
    assert items[2].correct is False and items[2].choice == 1 and items[2].answer == 0
    # Soal tidak dijawab = salah (bukan error) — pilihan None.
    partial = grade_quiz(questions, {1: 1, 2: 1})
    unanswered = {i.question_id: i for i in partial.items}[3]
    assert unanswered.correct is False and unanswered.choice is None


def test_grade_quiz_dengan_ambang_lulus():
    questions = [(1, "Q1", 0, None), (2, "Q2", 0, None), (3, "Q3", 1, None)]
    # 2/3 = 67% → di bawah ambang 70%.
    failed = with_threshold(grade_quiz(questions, {1: 0, 2: 0, 3: 0}), PASS_PERCENT)
    assert failed.percent == 67 and failed.passed is False
    # 3/3 = 100% → lulus.
    passed = with_threshold(grade_quiz(questions, {1: 0, 2: 0, 3: 1}), PASS_PERCENT)
    assert passed.percent == 100 and passed.passed is True
    # Tepat di ambang.
    exact = with_threshold(grade_quiz(questions, {1: 0, 2: 0, 3: 1}), 100)
    assert exact.passed is True


def test_block_label_dan_pesan_hasil():
    assert block_label({"type": "quote"}) == "Kutipan"
    assert quiz_result_message(passed=False, points_awarded=0).startswith("Belum lulus")
    assert "+20" in quiz_result_message(passed=True, points_awarded=20)
    assert "sebelumnya" in quiz_result_message(passed=True, points_awarded=0)


# ═══ Helper data ═══


async def _seed_module(
    db_session,
    *,
    title: str = "Modul Uji",
    slug: str = "modul-uji",
    published: bool = True,
    n_lessons: int = 2,
    questions: int = 3,
) -> Module:
    module = Module(title=title, slug=slug, order=1, is_published=published)
    db_session.add(module)
    await db_session.flush()
    for i in range(n_lessons):
        db_session.add(
            Lesson(
                module_id=module.id,
                title=f"Pelajaran {i + 1}",
                content=[{"type": "paragraph", "text": f"Isi pelajaran {i + 1}."}],
                order=i,
            )
        )
    if questions:
        quiz = Quiz(module_id=module.id)
        db_session.add(quiz)
        await db_session.flush()
        for i in range(questions):
            db_session.add(
                QuizQuestion(
                    quiz_id=quiz.id,
                    question=f"Soal {i + 1}?",
                    options=["A", "B", "C"],
                    answer=1,
                    explanation=f"Penjelasan {i + 1}",
                    order=i,
                )
            )
    await db_session.commit()
    return module


# ═══ Endpoint user: daftar & detail ═══


async def test_daftar_modul_kosong(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/modules", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["summary"] == {"completed": 0, "total": 0}


async def test_daftar_modul_dgn_progres_nol(client, member_user, db_session):
    await _seed_module(db_session)
    await _seed_module(db_session, title="Draft", slug="draft", published=False)
    token = await login_token(client, member_user.email, "password123")
    body = (await client.get("/v1/modules", headers={"Authorization": f"Bearer {token}"})).json()
    # Draft tidak tampil.
    assert len(body["items"]) == 1
    card = body["items"][0]
    assert card["title"] == "Modul Uji"
    assert card["lesson_count"] == 2
    assert card["quiz_question_count"] == 3
    assert card["quiz_points"] == QUIZ_POINTS
    assert card["progress"] == {
        "lessons_done": 0,
        "total_lessons": 2,
        "percent": 0,
        "is_completed": False,
    }
    assert card["cta"] == "Mulai"
    assert body["summary"] == {"completed": 0, "total": 1}


async def test_detail_modul_tanpa_kunci_jawaban(client, member_user, db_session):
    module = await _seed_module(db_session)
    token = await login_token(client, member_user.email, "password123")
    body = (
        await client.get(f"/v1/modules/{module.id}", headers={"Authorization": f"Bearer {token}"})
    ).json()
    assert body["progress"]["total_lessons"] == 2
    assert [ls["title"] for ls in body["lessons"]] == ["Pelajaran 1", "Pelajaran 2"]
    quiz = body["quiz"]
    assert quiz["pass_percent"] == PASS_PERCENT
    assert quiz["points"] == QUIZ_POINTS
    assert len(quiz["questions"]) == 3
    for q in quiz["questions"]:
        assert "answer" not in q  # kunci tidak pernah bocor
    assert body["quiz_best"] is None


async def test_modul_tak_publik_404(client, member_user, db_session):
    module = await _seed_module(db_session, published=False)
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get(
        f"/v1/modules/{module.id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 404


# ═══ Endpoint user: pelajaran & progres ═══


async def test_selesaikan_pelajaran_progres_berurutan(client, member_user, db_session):
    module = await _seed_module(db_session)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    detail = (await client.get(f"/v1/modules/{module.id}", headers=headers)).json()
    lesson_ids = [ls["id"] for ls in detail["lessons"]]

    # Pelajaran pertama.
    r1 = await client.post(f"/v1/lessons/{lesson_ids[0]}/complete", headers=headers)
    assert r1.status_code == 200
    body1 = r1.json()
    assert body1["lessons_done"] == 1
    assert body1["percent"] == 50
    assert body1["is_completed"] is False and body1["just_completed"] is False

    # Baca ulang pelajaran pertama — progres tidak berubah.
    r_again = await client.post(f"/v1/lessons/{lesson_ids[0]}/complete", headers=headers)
    assert r_again.json()["lessons_done"] == 1

    # Pelajaran kedua → modul tuntas.
    r2 = await client.post(f"/v1/lessons/{lesson_ids[1]}/complete", headers=headers)
    body2 = r2.json()
    assert body2["lessons_done"] == 2
    assert body2["percent"] == 100
    assert body2["is_completed"] is True and body2["just_completed"] is True
    assert "kuis" in body2["message"].lower()

    # Pelajaran kedua lagi — transisi tidak diulang (idempoten).
    r3 = await client.post(f"/v1/lessons/{lesson_ids[1]}/complete", headers=headers)
    assert r3.json()["just_completed"] is False


async def test_modul_selesai_memicu_event_dan_streak(client, member_user, db_session):
    module = await _seed_module(db_session)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}
    detail = (await client.get(f"/v1/modules/{module.id}", headers=headers)).json()

    for ls in detail["lessons"]:
        await client.post(f"/v1/lessons/{ls['id']}/complete", headers=headers)

    events = (
        await db_session.scalars(
            select(AnalyticsEvent).where(AnalyticsEvent.name == "modul_selesai")
        )
    ).all()
    assert len(events) == 1
    assert events[0].payload["source"] == "pelajaran"
    assert events[0].payload["module_id"] == module.id

    await db_session.refresh(member_user)
    assert member_user.current_streak == 1  # streak ikut berdetak
    # Tidak ada poin dari pelajaran — poin hanya kuis (keputusan sprint).
    assert member_user.points == 0
    assert (await db_session.scalar(select(func.count()).select_from(PointTransaction))) == 0


async def test_detail_lesson_memuat_blok_dan_next(client, member_user, db_session):
    module = await _seed_module(db_session)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}
    detail = (await client.get(f"/v1/modules/{module.id}", headers=headers)).json()
    first, second = detail["lessons"]

    body = (await client.get(f"/v1/lessons/{first['id']}", headers=headers)).json()
    assert body["module_title"] == "Modul Uji"
    assert body["blocks"][0]["type"] == "paragraph"
    assert body["next_lesson_id"] == second["id"]
    assert body["done"] is False

    body2 = (await client.get(f"/v1/lessons/{second['id']}", headers=headers)).json()
    assert body2["next_lesson_id"] is None  # pelajaran terakhir


# ═══ Endpoint user: kuis — penilaian, poin, anti dobel ═══


async def _submit_all_answers(client, headers, module_id, choice: int):
    quiz = (await client.get(f"/v1/modules/{module_id}/quiz", headers=headers)).json()
    answers = [{"question_id": q["id"], "choice": choice} for q in quiz["questions"]]
    return await client.post(
        f"/v1/modules/{module_id}/quiz", json={"answers": answers}, headers=headers
    )


async def test_kuis_gagal_tanpa_poin(client, member_user, db_session):
    module = await _seed_module(db_session)  # kunci = 1
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await _submit_all_answers(client, headers, module.id, choice=0)
    assert resp.status_code == 200
    body = resp.json()
    assert body["score"] == 0
    assert body["percent"] == 0
    assert body["passed"] is False
    assert body["points_awarded"] == 0
    assert len(body["review"]) == 3  # kunci terbuka SETELAH submit
    assert body["review"][0]["answer"] == 1

    await db_session.refresh(member_user)
    assert member_user.points == 0
    attempt = (await db_session.scalars(select(UserQuizAttempt))).first()
    assert attempt is not None and attempt.passed is False
    # Kuis gagal bukan momen modul_selesai.
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(AnalyticsEvent)
            .where(AnalyticsEvent.name == "modul_selesai")
        )
    ) == 0


async def test_kuis_lulus_poin_event_streak_notif(client, member_user, db_session):
    module = await _seed_module(db_session)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await _submit_all_answers(client, headers, module.id, choice=1)
    body = resp.json()
    assert body["passed"] is True
    assert body["percent"] == 100
    assert body["points_awarded"] == QUIZ_POINTS
    assert body["points_total"] == QUIZ_POINTS

    # Ledger append-only + cache poin.
    await db_session.refresh(member_user)
    assert member_user.points == QUIZ_POINTS
    ledger = (
        await db_session.scalars(select(PointTransaction).where(PointTransaction.source == "quiz"))
    ).all()
    assert len(ledger) == 1 and ledger[0].amount == QUIZ_POINTS

    attempt = (await db_session.scalars(select(UserQuizAttempt))).first()
    assert attempt.passed is True and attempt.points_awarded == QUIZ_POINTS

    # Event modul_selesai (source=kuis) + streak.
    event = (
        await db_session.scalars(
            select(AnalyticsEvent).where(AnalyticsEvent.name == "modul_selesai")
        )
    ).first()
    assert event is not None and event.payload["source"] == "kuis"
    await db_session.refresh(member_user)
    assert member_user.current_streak == 1

    # Notifikasi poin masuk.
    from app.models import Notification

    notif = (
        await db_session.scalars(select(Notification).where(Notification.type == "info"))
    ).first()
    assert notif is not None and "poin" in notif.title.lower()


async def test_kuis_diulang_tidak_dobel_poin(client, member_user, db_session):
    module = await _seed_module(db_session)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    first = await _submit_all_answers(client, headers, module.id, choice=1)
    assert first.json()["points_awarded"] == QUIZ_POINTS

    second = await _submit_all_answers(client, headers, module.id, choice=1)
    body = second.json()
    assert body["passed"] is True
    assert body["points_awarded"] == 0  # anti dobel poin
    assert body["already_passed_before"] is True

    attempts = (await db_session.scalars(select(UserQuizAttempt))).all()
    assert len(attempts) == 2
    assert sum(a.points_awarded for a in attempts) == QUIZ_POINTS

    await db_session.refresh(member_user)
    assert member_user.points == QUIZ_POINTS  # tidak bertambah
    # Event hanya sekali.
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(AnalyticsEvent)
            .where(AnalyticsEvent.name == "modul_selesai")
        )
    ) == 1


async def test_kuis_setelah_gagal_lalu_lulus_dapat_poin(client, member_user, db_session):
    module = await _seed_module(db_session)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    failed = await _submit_all_answers(client, headers, module.id, choice=0)
    assert failed.json()["passed"] is False
    passed = await _submit_all_answers(client, headers, module.id, choice=1)
    assert passed.json()["points_awarded"] == QUIZ_POINTS  # percobaan berikutnya tetap berhak
    assert passed.json()["already_passed_before"] is False


async def test_kuis_bank_soal_tanpa_jawaban(client, member_user, db_session):
    module = await _seed_module(db_session)
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get(
        f"/v1/modules/{module.id}/quiz", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["question_count"] == 3
    assert all("answer" not in q for q in body["questions"])


async def test_submit_jawaban_tak_cocok_400(client, member_user, db_session):
    module = await _seed_module(db_session)
    token = await login_token(client, member_user.email, "password123")
    resp = await client.post(
        f"/v1/modules/{module.id}/quiz",
        json={"answers": [{"question_id": 99999, "choice": 0}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


# ═══ Admin: CRUD modul / pelajaran / bank soal ═══

MODULE_PAYLOAD = {
    "title": "Fiqih Sampah Lanjutan",
    "description": "Modul uji admin",
    "cover_url": "fa-recycle",
    "order": 5,
    "is_published": False,
}


def _admin_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_admin_modules_butuh_role(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    assert (
        await client.post("/v1/admin/modules", json=MODULE_PAYLOAD, headers=_admin_headers(token))
    ).status_code == 403
    assert (await client.get("/v1/admin/modules", headers=_admin_headers(token))).status_code == 403


async def test_admin_crud_modul_slug_otomatis(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.post(
        "/v1/admin/modules", json=MODULE_PAYLOAD, headers=_admin_headers(token)
    )
    assert resp.status_code == 201, resp.text
    module = resp.json()
    assert module["slug"] == "fiqih-sampah-lanjutan"
    assert module["is_published"] is False

    # Slug eksplisit yang dipakai modul lain → 409.
    dup = await client.post(
        "/v1/admin/modules",
        json={**MODULE_PAYLOAD, "slug": "fiqih-sampah-lanjutan"},
        headers=_admin_headers(token),
    )
    assert dup.status_code == 409
    # Tanpa slug → otomatis di-suffix agar unik (tidak 409).
    auto = await client.post(
        "/v1/admin/modules",
        json={**MODULE_PAYLOAD, "title": "Fiqih Sampah Lanjutan!"},
        headers=_admin_headers(token),
    )
    assert auto.status_code == 201
    assert auto.json()["slug"] == "fiqih-sampah-lanjutan-2"

    patched = await client.patch(
        f"/v1/admin/modules/{module['id']}",
        json={"is_published": True, "order": 2},
        headers=_admin_headers(token),
    )
    assert patched.status_code == 200
    assert patched.json()["is_published"] is True and patched.json()["order"] == 2

    listing = (await client.get("/v1/admin/modules", headers=_admin_headers(token))).json()
    assert len(listing) == 2  # modul asli + versi slug auto-suffix
    assert listing[0]["lesson_count"] == 0


async def test_admin_hapus_modul_dgn_progres_409(client, admin_user, member_user, db_session):
    module = await _seed_module(db_session)
    db_session.add(UserModuleProgress(user_id=member_user.id, module_id=module.id, lessons_done=1))
    await db_session.commit()

    token = await login_token(client, admin_user.email, "password123")
    resp = await client.delete(f"/v1/admin/modules/{module.id}", headers=_admin_headers(token))
    assert resp.status_code == 409
    assert "nonaktifkan" in resp.json()["detail"].lower()


async def test_admin_lesson_blok_tervalidasi(client, admin_user, db_session):
    module = await _seed_module(db_session, n_lessons=0, questions=0)
    token = await login_token(client, admin_user.email, "password123")

    # Blok invalid → 400 dgn pesan jelas.
    bad = await client.post(
        f"/v1/admin/modules/{module.id}/lessons",
        json={"title": "Pelajaran Uji", "blocks": [{"type": "video", "text": "x"}]},
        headers=_admin_headers(token),
    )
    assert bad.status_code == 400

    good = await client.post(
        f"/v1/admin/modules/{module.id}/lessons",
        json={
            "title": "Pelajaran Uji",
            "blocks": [
                {"type": "paragraph", "text": "Paragraf pembuka."},
                {"type": "quote", "text": '"Kutipan."', "arabic": "نَصّ", "source": "QS. 1:1"},
                {"type": "tip", "text": "Tips singkat."},
            ],
        },
        headers=_admin_headers(token),
    )
    assert good.status_code == 201, good.text
    lesson = good.json()
    assert len(lesson["blocks"]) == 3
    assert lesson["order"] == 0  # modul tanpa pelajaran → mulai dari 0

    # Ubah blok + urutan.
    patched = await client.patch(
        f"/v1/admin/lessons/{lesson['id']}",
        json={"order": 3, "blocks": [{"type": "tip", "text": "Blok baru."}]},
        headers=_admin_headers(token),
    )
    assert patched.status_code == 200
    assert patched.json()["order"] == 3 and patched.json()["blocks"][0]["type"] == "tip"

    deleted = await client.delete(
        f"/v1/admin/lessons/{lesson['id']}", headers=_admin_headers(token)
    )
    assert deleted.status_code == 204


async def test_admin_bank_soal_kuis_otomatis(client, admin_user, db_session):
    module = await _seed_module(db_session, questions=0)
    token = await login_token(client, admin_user.email, "password123")

    # Modul belum punya kuis.
    assert (
        await db_session.scalars(select(Quiz).where(Quiz.module_id == module.id))
    ).first() is None

    # Kunci jawaban di luar jangkauan opsi → 400.
    bad = await client.post(
        f"/v1/admin/modules/{module.id}/questions",
        json={"question": "Soal?", "options": ["A", "B"], "answer": 5},
        headers=_admin_headers(token),
    )
    assert bad.status_code == 400

    created = await client.post(
        f"/v1/admin/modules/{module.id}/questions",
        json={
            "question": "Sampah kertas termasuk…",
            "options": ["Anorganik", "Organik", "B3"],
            "answer": 0,
            "explanation": "Kertas bisa didaur ulang.",
        },
        headers=_admin_headers(token),
    )
    assert created.status_code == 201, created.text
    question = created.json()
    assert question["order"] == 0

    # Kuis dibuat otomatis + soal kedua urut.
    second = await client.post(
        f"/v1/admin/modules/{module.id}/questions",
        json={"question": "Soal kedua?", "options": ["Ya", "Tidak"], "answer": 1},
        headers=_admin_headers(token),
    )
    assert second.json()["order"] == 1

    listing = await client.get(
        f"/v1/admin/modules/{module.id}/questions", headers=_admin_headers(token)
    )
    assert [q["id"] for q in listing.json()] == [question["id"], second.json()["id"]]

    # PATCH ubah kunci jawaban.
    patched = await client.patch(
        f"/v1/admin/questions/{question['id']}",
        json={"answer": 1},
        headers=_admin_headers(token),
    )
    assert patched.json()["answer"] == 1

    deleted = await client.delete(
        f"/v1/admin/questions/{question['id']}", headers=_admin_headers(token)
    )
    assert deleted.status_code == 204
