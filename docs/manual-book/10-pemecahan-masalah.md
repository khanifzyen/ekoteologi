# Bab 10 — Pemecahan Masalah & FAQ

## 10.1 Matriks Hak Akses Ringkas

Simpan halaman ini sebagai acuan cepat:

| Aksi | Admin | Verifier | Editor |
|---|:-:|:-:|:-:|
| Melihat Dashboard, Pengguna, Misi, Konten, E-Learning, Push (riwayat) | ✅ | ✅ | ✅ |
| Setujui/Tolak bukti misi (Bab 5) | ✅ | ✅ | ❌ |
| Tambah/ubah misi, konten, modul, pelajaran, soal | ✅ | ❌ | ✅ |
| Hapus misi/konten/modul/pelajaran/soal | ✅ | ❌ | ❌ |
| Nonaktifkan/aktifkan misi | ✅ | ❌ | ✅ |
| Kirim push notifikasi | ✅ | ❌ | ❌ |

Tombol yang tidak tersedia untuk peran Anda disembunyikan dari layar; dan meski
dipanggil langsung lewat API, server tetap menolak (lapisan kedua).

## 10.2 Pesan Error Umum & Artinya

| Pesan | Arti & tindakan |
|---|---|
| *"Tidak dapat terhubung ke server. Periksa koneksi Anda."* | API tidak terjangkau — cek koneksi, atau laporkan bila API server mati |
| *"Anda tidak memiliki akses ke resource ini."* (403) | Peran Anda tidak cukup untuk aksi itu (lihat matriks di atas) |
| *"Akun Anda tidak memiliki akses ke panel admin."* | Anda login dengan akun role `user` — gunakan akun panel |
| Sesibaik-anda diminta login lagi di tengah pekerjaan | Sesi kedaluwarsa; login kembali — data form yang belum disimpan perlu diisi ulang |
| Toast *"Keputusan gagal dikirim — coba lagi."* (Bab 5) | Gangguan jaringan saat memutuskan; ulangi aksi |
| Error `409` saat menghapus modul | Modul sudah punya progres pengguna — nonaktifkan saja |
| Konten ditolak saat disimpan (tanggal bentrok) | Sudah ada konten untuk tanggal itu — ubah konten lama atau pilih tanggal lain |

## 10.3 FAQ

**Q: Apakah saya perlu mengecek hasil scan AI pengguna?**
Tidak. Scan diproses otomatis oleh AI di server. Tugas review manusia hanya untuk
bukti foto misi (Bab 5).

**Q: Kenapa jumlah "Klaim" di daftar misi lebih besar dari angka kuning
"menunggu"?**
Kolom Klaim menampilkan total klaim sepanjang waktu; angka kuning hanya yang
masih menunggu keputusan Anda di antrian verifikasi.

**Q: Misi sudah lewat acaranya, apa yang harus dilakukan?**
Nonaktifkan (tombol **Nonaktifkan**). Jangan hapus — misi yang pernah diklaim
tidak dapat dihapus karena riwayatnya dipakai poin & badge pengguna.

**Q: Saya salah menyetujui bukti — bagaimana membatalkannya?**
Tidak ada pembatalan dari panel. Laporkan ke tim backend untuk koreksi manual
(poin pengguna dikelola sebagai buku besar append-only).

**Q: Bagaimana mengganti kata sandi akun panel?**
Belum tersedia di panel. Minta reset dari sisi server (admin utama/PO).

**Q: Kenapa menu Audit Log, Laporan, Reward, Moderasi, Peta tidak bisa dibuka?**
Belum diimplementasikan (lihat label grup *SISTEM*/*FASE 2* dan badge *SEGERA*).
Klik hanya memunculkan info bahwa modul menyusul.

**Q: Bisakah push notifikasi dijadwalkan untuk nanti?**
Belum — pengiriman berjalan langsung setelah konfirmasi (Bab 9). Rencanakan waktu
kirim Anda sesuai kebutuhan.

**Q: Berapa lama bukti misi harus diputuskan?**
SLA internal **1×24 jam** sejak bukti diunggah (badge SLA di halaman verifikasi).

**Q: Kartu Biaya LLM menampilkan "mode LLM mock" — apa itu?**
Server memakai provider LLM tiruan (uji). Tidak ada biaya nyata; hubungi tim
backend bila seharusnya sudah live.

## 10.4 Kontak Eskalasi

- **Bug panel/API** — buat issue di repositori `ekoteologi` dengan langkah
  reproduksi + tangkapan layar.
- **Koreksi data pengguna** (poin, keputusan verifikasi, akun) — tim backend.
- **Kredensial & role** — admin utama/PO.

---

*Kembali ke [Daftar Isi](README.md).*
