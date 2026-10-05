# 🔄 Laporan Pembaruan Data Database Claudewa (`pembaruan_migrasi.md`)

Dokumen ini memuat catatan lengkap pembaruan skema dan data database **Claudewa WhatsApp** ke server database baru (`prototype-whatsapp`), membandingkan data awal (baseline) dengan data terbaru dari file [**`claudewa-lengkap.sql`**](claudewa-lengkap.sql) dan [**`claudewa-data.sql`**](claudewa-data.sql).

---

## 📌 1. Ringkasan Pembaruan

* **Waktu Pelaksanaan:** 2026-10-05 07:55 WIB
* **Target Server:** `<host-database>:5432/<nama-database>`
* **Metode:** Reset bersih data lama (*clean drop & recreate*), penerapan skema 13 migrasi DDL terbaru, dan import data riil dari `claudewa-data.sql`.
* **Total Record Data Baru:** **1.075 baris data** (meningkat **+218 record** dari data awal yang berjumlah 857 record).
* **Total Migrasi Prisma:** **13 migrasi** (bertambah 1 migrasi baru).
* **Status:** **SUKSES 100% (Semua relasi Foreign Key & Data Terverifikasi)**.

---

## 📊 2. Tabel Perbandingan Data: Awal vs Terbaru

Berikut adalah rincian perbandingan data per tabel antara versi data awal dan versi setelah pembaruan:

| No | Nama Tabel | Data Awal | Data Terbaru | Selisih (+/-) | Keterangan Perubahan |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | `_prisma_migrations` | 12 | **13** | **+1** | Penambahan migrasi `20261004010000_ai_endpoint_kind` |
| 2 | `Organization` | 1 | **1** | 0 | Organisasi internal utama |
| 3 | `User` | 2 | **2** | 0 | Akun user (`Zulfikar Ramzi` & `Claude Uji`) |
| 4 | `ChannelAccess` | 0 | **0** | 0 | Tidak ada perubahan |
| 5 | `Channel` | 1 | **1** | 0 | Channel WhatsApp Meta Cloud API |
| 6 | `Contact` | 16 | **20** | **+4** | 4 kontak warga/pengguna baru tersimpan |
| 7 | `AiEndpoint` | 1 | **2** | **+1** | Penambahan endpoint baru `Router tiruan (lokal)` dengan kind `ROUTE` |
| 8 | `Template` | 2 | **2** | 0 | Template pesan WhatsApp |
| 9 | `Campaign` | 1 | **1** | 0 | Kampanye blast pesan |
| 10 | `CampaignRecipient` | 15 | **15** | 0 | Penerima kampanye |
| 11 | `Conversation` | 16 | **20** | **+4** | 4 sesi percakapan chat baru |
| 12 | `Flow` | 5 | **5** | 0 | Alur logika interaktif bot |
| 13 | `FlowVersion` | 13 | **14** | **+1** | 1 versi revisi alur chatbot baru |
| 14 | `FlowSession` | 35 | **47** | **+12** | 12 sesi interaksi alur baru bersama pengguna |
| 15 | `Message` | 277 | **347** | **+70** | **70 pesan chat baru** (pertanyaan warga & respon bot) |
| 16 | `WebhookEvent` | 416 | **540** | **+124** | **124 payload event webhook baru** dari WhatsApp |
| 17 | `AuditLog` | 56 | **58** | **+2** | 2 log riwayat aktivitas baru |
| **-** | **TOTAL DATA RECORD** | **857** | **1.075** | **+218** | **Kenaikan volume data operasional** |
| **-** | **TOTAL DENGAN MIGRATIONS** | **869** | **1.088** | **+219** | **Seluruh baris terverifikasi di PostgreSQL** |

---

## 🛠️ 3. Perubahan Skema DDL (Database Schema Updates)

Dalam pembaruan ini, skema database di [`claudewa-lengkap.sql`](claudewa-lengkap.sql) mencakup migrasi ke-13 Prisma:

### 1. Penambahan Tipe Enum `AiEndpointKind`
```sql
CREATE TYPE "AiEndpointKind" AS ENUM ('ANSWER', 'ROUTE');
```
* `ANSWER`: Endpoint AI yang menghasilkan jawaban/konten langsung (seperti AI Layanan RAG).
* `ROUTE`: Endpoint AI untuk routing intent / pengalihan pesan pengguna.

### 2. Penambahan Kolom `kind` pada Tabel `AiEndpoint`
```sql
ALTER TABLE "AiEndpoint" ADD COLUMN "kind" "AiEndpointKind" NOT NULL DEFAULT 'ANSWER';
```

### 3. Migrasi Prisma Baru di `_prisma_migrations`
* **Nama Migrasi:** `20261004010000_ai_endpoint_kind`
* **Checksum:** `cb319331738027c703b10727994084bb7dc7d2e2eb0d83828d6affd758bc2116`
* **Status:** `applied_steps_count = 1`

---

## 📁 4. Pembaruan File Lokal Project

Untuk menjaga konsistensi 100% antara database PostgreSQL dan asset proyek, file-file berikut telah otomatis disinkronkan:

1. **[`claudewa_data.json`](claudewa_data.json)**:
   - Metadata diperbarui dengan sumber dari `claudewa-data.sql` dan `claudewa-lengkap.sql`.
   - Total records tercatat: **1.088 records**.
2. **Folder [`seeds/`](seeds/)**:
   - Seluruh 16 file JSON per tabel diperbarui ke data terbaru (`Message.json` kini 347 pesan, `WebhookEvent.json` 540 event, `FlowSession.json` 47 sesi, `Contact.json` 20 kontak, dll).

---

## ⚡ 5. Tahapan Eksekusi yang Telah Dilakukan

1. **Pembersihan Data Lama (Clean Reset):**
   - Menghapus schema `public` lama secara bersih (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`) untuk memastikan tidak ada konflik Primary Key, data usang, atau constraint ganda.
2. **Penerapan Skema DDL Terbaru:**
   - Mengeksekusi DDL lengkap dari `claudewa-lengkap.sql` (14 Enum, 19+ tabel, foreign key, index, dan RLS).
3. **Pengosongan Data Baseline:**
   - Melakukan `TRUNCATE TABLE ... CASCADE` pada tabel-tabel data untuk menyisakan skema dan migrasi saja.
4. **Import Data Riil Terbaru:**
   - Mengeksekusi `claudewa-data.sql` dalam satu transaksi atomik (`BEGIN ... COMMIT`) sehingga seluruh 1.075 record data masuk tanpa *foreign key violation*.
5. **Verifikasi Penghitungan Langsung:**
   - Menjalankan kueri `SELECT count(*)` ke setiap tabel di PostgreSQL dan memvalidasi kecocokan dengan seluruh file data.
