"""Bank quote terkurasi per kategori sampah (Sprint 2).

PRD §9 (risiko "hasil LLM tidak akurat/halusinasi quote"): kutipan ayat/hadis
**dicocokkan dari bank terkurasi via kategori, bukan digenerasi LLM**. LLM tetap
diminta menyarankan quote (kontrak PRD §2.2) namun server selalu menggantinya
dengan entri bank ini sebelum disimpan/dikirim ke klien.
"""

from datetime import date

from app.schemas.scan import Quote

# Dikurasi manual; sumber ditulis ringkas. Tambahkan lewat PR berikutnya (bukan LLM).
_QUOTE_BANK: dict[str, Quote] = {
    "Organik": Quote(
        text="Dia menciptakan kamu dari bumi dan memakmurkannya (meminta kamu memakmurnya).",
        source="QS Hud: 61",
    ),
    "Plastik": Quote(
        text="Sesungguhnya Allah tidak menyukai orang yang berlebih-lebihan (berbuat rusak).",
        source="QS Al-An'am: 141",
    ),
    "Kertas": Quote(
        text=(
            "Tidaklah seorang muslim menanam pohon lalu darinya dimakan burung, manusia, "
            "atau hewan, melainkan itu menjadi sedekah baginya."
        ),
        source="HR Bukhari no. 2320",
    ),
    "Kaca": Quote(
        text=(
            "Allah adalah cahaya langit dan bumi. Perumpamaan cahaya-Nya seperti sebuah "
            "cermin (mishkah) di dalamnya ada lampu."
        ),
        source="QS An-Nur: 35",
    ),
    "Logam": Quote(
        text=(
            "Dan sungguh Kami telah mengirim besi yang padanya terdapat kekuatan hebat dan "
            "berbagai manfaat bagi manusia."
        ),
        source="QS Al-Hadid: 25",
    ),
    "B3": Quote(
        text="Janganlah kamu berbuat kerusakan di bumi setelah (diciptakan) dengan baik.",
        source="QS Al-A'raf: 56",
    ),
    "Residu": Quote(
        text=(
            "Iman itu ada tujuh puluh sekian cabang; yang tertinggi adalah laa ilaaha "
            "illallah, dan yang terendah adalah menyingkirkan gangguan dari jalan."
        ),
        source="HR Muslim no. 35",
    ),
}

# Kutipan umum bila kategori tidak ada di bank (mis. kategori baru dari admin).
_FALLBACK = Quote(
    text=(
        "Dunia itu hijau dan manis; sungguh Allah menjadikan kalian khalifah di dalamnya, "
        "maka perhatikanlah bagaimana kalian berbuat."
    ),
    source="HR Muslim no. 2742",
)


def quote_for_category(category_name: str) -> Quote:
    """Kembalikan quote bank utk kategori; fallback ke kutipan umum."""
    return _QUOTE_BANK.get(category_name.strip().title(), _FALLBACK)


def daily_fallback_quote(day: date) -> Quote:
    """Kutipan "Kutipan Hari Ini" ketika TIDAK ada konten terjadwal (Sprint 6).

    Rotasi deterministik per tanggal atas seluruh bank (termasuk fallback umum):
    hari sama = kutipan sama di semua server — tanpa randomness, tanpa state.
    Sumber tetap satu: bank terkurasi ini (satu sumber kebenaran dgn scan).
    """
    ordered = list(_QUOTE_BANK.values()) + [_FALLBACK]
    return ordered[day.timetuple().tm_yday % len(ordered)]
