# Bab 1 — Pengenalan Sistem

## 1.1 Tentang Panel Admin

Panel Admin Ekoteologi AR adalah aplikasi web untuk tim internal (admin, verifier,
editor) yang menjadi pusat kendali aplikasi mobile Ekoteologi AR. Lewat panel ini
tim dapat:

- memantau pertumbuhan pengguna, aktivitas scan, dan biaya LLM (**Dashboard**),
- meninjau akun pengguna yang terdaftar (**Pengguna**),
- menyetujui atau menolak bukti foto misi yang dikirim pengguna (**Verifikasi Misi**),
- mengelola misi harian/mingguan/spesial (**Misi**),
- menjadwalkan kutipan harian yang tampil di aplikasi (**Konten Harian**),
- menulis modul belajar dan soal kuis (**E-Learning**),
- mengirim pengumuman ke aplikasi pengguna (**Push Notifikasi**).

> **Penting:** hasil scan sampah oleh AI **tidak diverifikasi admin**. Scan diproses
> otomatis oleh LLM di sisi API; yang muncul di panel hanyalah agregatnya
> (jumlah scan, komposisi kategori, biaya). Yang perlu keputusan manusia adalah
> **bukti foto misi** — lihat Bab 5.

## 1.2 Peran & Hak Akses

Ada tiga peran panel. Peran ditentukan di sisi server, jadi menu yang disembunyikan
di layar juga tidak bisa dipanggil lewat cara lain.

| Kemampuan | Administrator | Verifier | Editor |
|---|:-:|:-:|:-:|
| Melihat semua halaman (dashboard, pengguna, dll.) | ✅ | ✅ | ✅ |
| Menyetujui / menolak bukti misi | ✅ | ✅ | ❌ |
| Membuat & mengubah misi, konten, modul, pelajaran, soal | ✅ | ❌ | ✅ |
| Menghapus misi, konten, modul, pelajaran, soal | ✅ | ❌ | ❌ |
| Mengirim push notifikasi | ✅ | ❌ | ❌ |

Akun dengan role `user` (pengguna biasa dari aplikasi mobile) **tidak bisa masuk**
panel; jika dipaksakan, sesi akan ditolak dengan pesan
*"Akun Anda tidak memiliki akses ke panel admin."*

Pembuatan akun admin dilakukan lewat server (script `create_admin`), bukan lewat
panel — lihat README proyek.

## 1.3 Tampilan Dasar Panel

Setelah masuk, tampilan panel terdiri atas tiga area:

1. **Sidebar kiri** — menu navigasi:
   - Menu utama: **Dashboard, Pengguna, Verifikasi Misi, Misi, Konten Harian, E-Learning**.
   - Grup **SISTEM**: **Push Notifikasi** (aktif), **Audit Log** dan **Laporan**
     (masih nonaktif — akan hadir di sprint berikutnya).
   - Grup **FASE 2** (badge "SEGERA"): **Reward, Moderasi, Peta** — belum tersedia.
   - Kartu akun di bagian bawah sidebar menampilkan nama dan peran Anda, plus
     tombol keluar (ikon panah).
2. **Bar atas** — kotak pencarian global (belum aktif), ikon lonceng menuju
   **Push Notifikasi**, dan avatar inisial akun Anda.
3. **Area konten** — isi halaman yang sedang dibuka.

Tombol yang sering muncul di semua halaman:

- **Segarkan** — memuat ulang data terbaru dari server.
- **Coba Lagi** — muncul saat data gagal dimuat (mis. koneksi terputus).
- **Batal** — menutup form tanpa menyimpan.

## 1.4 Perangkat & Peramban yang Didukung

Panel dioptimalkan untuk peramban modern desktop (Chrome, Edge, Firefox) dengan
lebar layar ≥ 1024 px. Pada layar sempit, sidebar berubah menjadi menu drawer yang
dibuka lewat tombol hamburger di bar atas.

## 1.5 Konvensi Notifikasi di Panel

- **Toast** — pesan singkat di layar selama ±3 detik untuk hasil aksi
  (mis. *"Misi baru dibuat."*). Tidak perlu diklik; cukup dibaca.
- **Konfirmasi browser** — aksi yang tidak bisa dibatalkan (hapus data, kirim push)
  selalu memunculkan dialog konfirmasi bawaan browser terlebih dahulu. Baca
  keterangannya, lalu pilih OK/Batal.
- Semua aksi penting (verifikasi, hapus, kirim push, perubahan konten) **tercatat
  di audit log** di sisi server.

Lanjut ke [Bab 2 — Masuk & Keluar Panel](02-masuk-panel.md).
