# 🚀 Dokumentasi Endpoint Production (`endpoint.md`)

Dokumentasi resmi seluruh endpoint REST API yang telah aktif dan ter-deploy secara live di **Railway Cloud**.

* **Base Production URL**: `https://ai-embed-production.up.railway.app`
* **Database Backend**: PostgreSQL Cloud Supabase + `pgvector`
* **AI Model Engine**: Google Gemini API (`gemini-embedding-001` & `gemini-2.5-flash-lite`)

---

## 📌 Ringkasan Cepat Endpoint

| No | Method | Endpoint Path | Deskripsi Utama |
| :---: | :---: | :--- | :--- |
| **1** | `POST` / `GET` | [`/webhook/wa`](#1-whatsapp-gateway-webhook-rekomendasi-chatbot) | **Webhook Khusus WhatsApp** (Auto-format Markdown WA) |
| **2** | `POST` / `GET` | [`/webhook`](#1-whatsapp-gateway-webhook-rekomendasi-chatbot) | Alias Webhook WhatsApp |
| **3** | `POST` / `GET` | [`/documents/search`](#2-pencarian-semantik--ai-feedback-assistant) | **Pencarian Semantik & AI Feedback Assistant** |
| **4** | `GET` | [`/documents`](#3-ambil-semua-dokumen) | Ambil daftar semua SOP dokumen di database |
| **5** | `GET` | [`/documents/{id}`](#4-ambil-dokumen-berdasarkan-id) | Ambil detail satu dokumen berdasarkan ID |
| **6** | `POST` | [`/documents`](#5-tambah-dokumen-baru) | Tambah dokumen baru (Auto-generate vector embedding) |
| **7** | `PUT` | [`/documents/{id}`](#6-update-dokumen) | Update dokumen (Auto-regenerate vector embedding) |
| **8** | `DELETE` | [`/documents/{id}`](#7-hapus-dokumen) | Hapus dokumen dari database |
| **9** | `POST` | [`/documents/seed`](#8-seeding-100-data-sop-layanan-publik) | Masukkan 100 data dummy SOP otomatis ke database |
| **10**| `POST` | [`/documents/reset`](#9-reset-bersih-database) | Hapus bersih tabel dan reset ID mulai dari 1 |
| **11**| `GET` | [`/`](#10-status-api--daftar-rute) | Cek status server & ringkasan rute |

---

## 📲 1. WhatsApp Gateway Webhook (Rekomendasi Chatbot)

Endpoint ini dirancang khusus untuk dihubungkan ke script **WhatsApp Gateway milikmu** (Node.js, Baileys, WPPConnect, Python, dsb.). Teks respon sudah diformat dengan tanda tebal `*...*`, miring `_..._`, dan pemisah rapi khas WhatsApp.

* **URL**: `https://ai-embed-production.up.railway.app/webhook/wa` *(atau `/webhook`)*
* **Method**: `POST` (Direkomendasikan) atau `GET`
* **Headers**: `Content-Type: application/json`

### Request Body (`POST`):
```json
{
  "sender": "628123456789",
  "message": "ktp saya hilang dompet kecopetan gimana ya"
}
```
> 💡 *Field fleksibel: kamu bisa memakai key `"message"`, `"text"`, `"query"`, atau `"body"`.*

### Response Body (`200 OK`):
```json
{
  "status": "success",
  "reply": "🏛️ *LAYANAN PUBLIK & INFORMASI SOP*\n━━━━━━━━━━━━━━━━━━━━━\n\n📋 *Layanan Terkait:*\n*Penerbitan Surat Keterangan Pengganti KTP Hilang* (Kependudukan)\n\n💬 *Respon AI:*\nHalo, kami turut prihatin atas musibah yang Anda alami. Anda dapat mengurus pencetakan kembali kartu identitas yang hilang melalui layanan Penerbitan Surat Keterangan Pengganti KTP Hilang.\n\n📖 *Panduan & Prosedur:*\nUntuk mengurus KTP yang hilang karena kecopetan, Anda perlu menyiapkan beberapa dokumen persyaratan dan mengikuti prosedur yang berlaku. Langkah pertama buatlah surat keterangan kehilangan dari Polsek terdekat, lalu bawa fotokopi KK ke kantor kelurahan/Disdukcapil...\n━━━━━━━━━━━━━━━━━━━━━\n_Semoga informasi ini membantu! Silakan tanyakan kembali jika ada kebutuhan lain._",
  "message": "🏛️ *LAYANAN PUBLIK & INFORMASI SOP* ...",
  "text": "🏛️ *LAYANAN PUBLIK & INFORMASI SOP* ...",
  "service": "Penerbitan Surat Keterangan Pengganti KTP Hilang",
  "category": "Kependudukan",
  "short_description": "Halo, kami turut prihatin atas musibah yang Anda alami...",
  "long_summary": "Untuk mengurus KTP yang hilang karena kecopetan, siapkan surat keterangan kehilangan dari Polsek...",
  "cache_hit": true,
  "cache_similarity": "94.64%",
  "source": "cache",
  "sender": "628123456789",
  "query": "ktp saya hilang dompet kecopetan gimana ya"
}
```

### Opsi Plain Text Langsung (`?format=text`):
Jika script bot kamu hanya menerima teks biasa (bukan JSON), tambahkan `?format=text`:
* `https://ai-embed-production.up.railway.app/webhook/wa?message=ktp+hilang&format=text`

#### Contoh cURL:
```bash
curl -X POST https://ai-embed-production.up.railway.app/webhook/wa \
  -H "Content-Type: application/json" \
  -d '{"sender": "628123456789", "message": "ktp hilang kecopetan"}'
```

---

## 🧠 2. Pencarian Semantik & AI Feedback Assistant

Endpoint inti untuk aplikasi web frontend, mobile apps, atau integrasi API murni yang membutuhkan struktur data JSON lengkap hasil pencarian semantik vektor.

* **URL**: `https://ai-embed-production.up.railway.app/documents/search`
* **Method**: `POST` atau `GET`
* **Headers**: `Content-Type: application/json`

### Request Body (`POST`):
```json
{
  "query": "saya mau daftar nikah tapi beda kecamatan berkasnya apa aja",
  "limit": 3
}
```

### Response Body (`200 OK`):
```json
{
  "status": "success",
  "source": "generated",
  "cache_hit": false,
  "query": "saya mau daftar nikah tapi beda kecamatan berkasnya apa aja",
  "feedback": {
    "related_service": "Rekomendasi Nikah Luar Wilayah Kecamatan (Surat Numpang Nikah)",
    "category": "Pernikahan & Agama",
    "short_description": "Untuk melangsungkan pernikahan di luar kecamatan domisili, Anda memerlukan Surat Rekomendasi Nikah (Numpang Nikah) dari KUA setempat.",
    "long_summary": "Pemohon wajib mengurus pengantar RT/RW, surat keterangan N1-N4 dari kelurahan, lalu mengajukan rekomendasi ke KUA domisili sebelum berkas didaftarkan ke KUA tujuan.",
    "best_similarity": 0.8124,
    "best_similarity_percentage": "81.24%"
  },
  "matched_sources": [
    {
      "id": 14,
      "category": "Pernikahan & Agama",
      "title": "Rekomendasi Nikah Luar Wilayah Kecamatan",
      "similarity": 0.8124,
      "similarity_percentage": "81.24%"
    }
  ]
}
```

#### Contoh cURL:
```bash
curl -X POST https://ai-embed-production.up.railway.app/documents/search \
  -H "Content-Type: application/json" \
  -d '{"query": "daftar nikah beda kecamatan", "limit": 3}'
```

---

## 📚 3. Ambil Semua Dokumen

Mengambil daftar master dokumen SOP yang tersimpan di Supabase.

* **URL**: `https://ai-embed-production.up.railway.app/documents`
* **Method**: `GET`
* **Query Parameters**:
  * `limit` (default: 50)
  * `offset` (default: 0)

### Response Body (`200 OK`):
```json
{
  "status": "success",
  "total": 100,
  "limit": 50,
  "offset": 0,
  "data": [
    {
      "id": 1,
      "category": "Kependudukan",
      "title": "Penerbitan KTP Elektronik Baru Pemula Usia 17 Tahun",
      "content": "Perekaman biometrik sidik jari, iris mata, dan foto wajah...",
      "created_at": "2026-09-28T01:44:23.19582Z"
    }
  ]
}
```

#### Contoh cURL:
```bash
curl -s https://ai-embed-production.up.railway.app/documents?limit=5
```

---

## 🔍 4. Ambil Dokumen Berdasarkan ID

* **URL**: `https://ai-embed-production.up.railway.app/documents/{id}`
* **Method**: `GET`

#### Contoh cURL:
```bash
curl -s https://ai-embed-production.up.railway.app/documents/1
```

---

## ➕ 5. Tambah Dokumen Baru

Menambahkan satu data SOP baru ke database. Gemini AI akan **secara otomatis men-generate vektor 768-dimensi** sebelum disimpan ke Supabase.

* **URL**: `https://ai-embed-production.up.railway.app/documents`
* **Method**: `POST`
* **Headers**: `Content-Type: application/json`

### Request Body:
```json
{
  "category": "Kesehatan",
  "title": "Pendaftaran Antrean Online Poliklinik RSUD",
  "content": "Pasien BPJS maupun Umum dapat mengambil nomor antrean berobat melalui aplikasi mobile RSUD H-1 sebelum jadwal dokter praktik."
}
```

### Response Body (`201 Created`):
```json
{
  "status": "success",
  "message": "Dokumen berhasil disimpan dengan ID: 101",
  "id": 101
}
```

#### Contoh cURL:
```bash
curl -X POST https://ai-embed-production.up.railway.app/documents \
  -H "Content-Type: application/json" \
  -d '{"category": "Kesehatan", "title": "Pendaftaran Antrean Online Poliklinik RSUD", "content": "Pasien BPJS dapat ambil antrean online H-1."}'
```

---

## ✏️ 6. Update Dokumen

Memperbarui isi dokumen. Vektor embedding akan **otomatis di-generate ulang** agar sesuai dengan konten yang baru.

* **URL**: `https://ai-embed-production.up.railway.app/documents/{id}`
* **Method**: `PUT`
* **Headers**: `Content-Type: application/json`

### Request Body:
```json
{
  "category": "Kesehatan",
  "title": "Pendaftaran Antrean Online Poliklinik RSUD (Revisi)",
  "content": "Pasien BPJS dan Umum wajib membawa rujukan faskes tingkat 1 saat verifikasi di loket antrean online."
}
```

#### Contoh cURL:
```bash
curl -X PUT https://ai-embed-production.up.railway.app/documents/101 \
  -H "Content-Type: application/json" \
  -d '{"category": "Kesehatan", "title": "Pendaftaran Antrean Online Poliklinik RSUD (Revisi)", "content": "Konten baru..."}'
```

---

## 🗑️ 7. Hapus Dokumen

* **URL**: `https://ai-embed-production.up.railway.app/documents/{id}`
* **Method**: `DELETE`

### Response Body (`200 OK`):
```json
{
  "status": "success",
  "message": "Dokumen dengan ID 101 berhasil dihapus."
}
```

#### Contoh cURL:
```bash
curl -X DELETE https://ai-embed-production.up.railway.app/documents/101
```

---

## ⚡ 8. Seeding 100 Data SOP Layanan Publik

Membaca data dari `dummy_data.json`, melakukan batch embedding 768 dimensi dengan Gemini, lalu memasukkannya ke tabel `documents` di Supabase.

* **URL**: `https://ai-embed-production.up.railway.app/documents/seed`
* **Method**: `POST`

#### Contoh cURL:
```bash
curl -X POST https://ai-embed-production.up.railway.app/documents/seed
```

---

## 🧹 9. Reset Bersih Database

Mengosongkan isi tabel `documents` dan `query_cache`, serta mereset urutan ID auto-increment kembali ke angka 1.

* **URL**: `https://ai-embed-production.up.railway.app/documents/reset`
* **Method**: `POST`

#### Contoh cURL:
```bash
curl -X POST https://ai-embed-production.up.railway.app/documents/reset
```

---

## 🩺 10. Status API & Daftar Rute

Pengecekan server liveness / health check.

* **URL**: `https://ai-embed-production.up.railway.app/`
* **Method**: `GET`

#### Contoh cURL:
```bash
curl -s https://ai-embed-production.up.railway.app/
```
