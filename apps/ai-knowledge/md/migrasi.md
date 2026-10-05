# 🌐 Panduan Migrasi Database ke Supabase PostgreSQL Cloud (`migrasi.md`)

Dokumen ini mendokumentasikan langkah demi langkah, arsitektur teknis, dan catatan penting mengenai migrasi database dari **PostgreSQL Lokal** ke **Supabase PostgreSQL Cloud** pada project **Go + pgvector + Gemini**.

---

## 📌 Ringkasan Migrasi

| Parameter | Sebelum Migrasi (Lokal) | Sesudah Migrasi (Cloud Supabase) |
| :--- | :--- | :--- |
| **Host Database** | `localhost:5432` | `aws-0-ap-southeast-1.pooler.supabase.com:5432` |
| **Akses Jaringan** | Hanya di komputer lokal | Cloud publik (bisa diakses dari mana saja) |
| **Protokol SSL** | `sslmode=disable` | `sslmode=require` (Wajib terenkripsi TLS/SSL) |
| **Mode Pooler** | Standar PostgreSQL connection | **Session-Mode Pooler** (Port 5432) |
| **Ekstensi `pgvector`** | Lokal PostgreSQL extension | Terintegrasi di cloud Supabase |
| **Tabel Terpasang** | `documents`, `query_cache` | `documents`, `query_cache` + HNSW Index |
| **Kapasitas Awal** | Kosong / Terpisah | **100 data SOP Layanan Publik** ter-embed |

---

## ⚙️ 1. Pemilihan Mode Koneksi Supabase

Supabase menyediakan beberapa jenis connection string URI. Untuk aplikasi Go yang menggunakan **pgx / pgxpool** dan **pgvector**, pemilihan port sangat krusial:

### ❌ Kenapa BUKAN Transaction Pooler (Port 6543 / `?pgbouncer=true`)?
* Transaction pooler (PgBouncer) memutus koneksi per transaksi.
* Driver `pgx` dan `pgvector-go` membutuhkan registrasi tipe data vektor di level session (`pgxvec.RegisterTypes(ctx, conn)`) serta menggunakan prepared statements. Pada port 6543, hal ini dapat menimbulkan galat query protokol.

### ✅ Mengapa Memilih Session Pooler (Port 5432)?
* **Session-Mode Pooler (Port 5432)** mempertahankan state session klien sehingga mendukung penuh fitur driver `pgxpool`, registrasi tipe custom `pgvector`, dan query berbasis HNSW vector cosine search tanpa batasan.
* Mendukung jaringan **IPv4** secara bawaan melalui pooler Supabase AWS regional (`aws-0-ap-southeast-1`).

---

## 🔑 2. Konfigurasi Environment Variable (`.env`)

Ubah konfigurasi pada file [`.env`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/.env):

```env
# Koneksi Database Cloud Supabase (Session Pooler Port 5432)
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require

# Konfigurasi Gemini AI
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-embedding-001
PORT=8080
```

> [!IMPORTANT]
> Pastikan parameter `?sslmode=require` selalu disertakan di akhir URL koneksi karena Supabase secara default menolak koneksi yang tidak terenkripsi SSL.

---

## 🏗️ 3. Skema & Ekstensi yang Diterapkan di Supabase

Saat aplikasi pertama kali dijalankan via [`main.go`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/main.go), fungsi [`db.InitSchema()`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/db/db.go#L127-L160) akan secara otomatis mengeksekusi DDL berikut ke database Supabase:

```sql
-- 1. Mengaktifkan ekstensi pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Membuat tabel master dokumen
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    category VARCHAR(100) NOT NULL DEFAULT 'Umum',
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(768) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Membuat indeks HNSW untuk pencarian dokumen berkecepatan tinggi
CREATE INDEX IF NOT EXISTS documents_embedding_idx 
ON documents USING hnsw (embedding vector_cosine_ops);

-- 4. Membuat tabel Semantic Query Cache
CREATE TABLE IF NOT EXISTS query_cache (
    id SERIAL PRIMARY KEY,
    query_text TEXT NOT NULL,
    query_embedding VECTOR(768) NOT NULL,
    feedback JSONB NOT NULL,
    matched_sources JSONB DEFAULT '[]'::jsonb,
    hit_count INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Membuat indeks HNSW untuk pencarian cache cepat
CREATE INDEX IF NOT EXISTS query_cache_embedding_idx 
ON query_cache USING hnsw (query_embedding vector_cosine_ops);
```

---

## 🚚 4. Tahapan Eksekusi Migrasi & Seeding Data

### Langkah 1: Jalankan Server Backend
Jalankan aplikasi Go agar terkoneksi ke Supabase dan membuat skema tabel secara otomatis:
```bash
go run main.go
```
*Output verifikasi di terminal:*
```text
 Mengkoneksikan ke PostgreSQL...
 Berhasil terkoneksi ke PostgreSQL!
 Memverifikasi ekstensi pgvector dan tabel 'documents'...
 Schema & ekstensi pgvector siap digunakan.
 Inisialisasi Gemini Embedding Client (gemini-embedding-001)...
 Gemini Embedder siap!

 Server REST API berjalan di http://localhost:8080
```

### Langkah 2: Lakukan Seeding Data ke Supabase
Trigger endpoint seeding untuk memproses 100 data SOP dari [dummy_data.json](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/dummy_data.json) ke cloud Supabase:
```bash
curl -X POST http://localhost:8080/documents/seed
```
*Proses ini akan:*
1. Membaca 100 item SOP.
2. Memanggil Gemini API untuk men-generate embedding vektor 768-dimensi untuk masing-masing dokumen.
3. Menyimpan seluruh data beserta vektornya ke tabel `documents` di Supabase.

---

## ✅ 5. Verifikasi Keberhasilan Migrasi

### 1. Verifikasi Jumlah Data di Supabase
Panggil endpoint `GET /documents?limit=1`:
```bash
curl -s http://localhost:8080/documents?limit=1
```
*Respon yang diharapkan:*
```json
{
  "status": "success",
  "total": 100,
  "limit": 1,
  "offset": 0,
  "data": [
    {
      "id": 1,
      "category": "Kependudukan",
      "title": "Penerbitan KTP Elektronik Baru Pemula Usia 17 Tahun",
      "content": "Perekaman biometrik sidik jari, iris mata...",
      "created_at": "2026-09-28T01:44:23.19582Z"
    }
  ]
}
```
> Total data bernilai **100**, menandakan seluruh data SOP telah masuk ke Supabase.

---

### 2. Verifikasi Fitur Semantic Search & Cache di Supabase
Kirim query pencarian:
```bash
curl -X POST http://localhost:8080/documents/search \
  -H "Content-Type: application/json" \
  -d '{"query": "ktp saya hilang dompet kecopetan gimana ya"}'
```
* **Panggilan ke-1 (Cache Miss)**: Data dokumen diambil dari Supabase via cosine vector distance, di-generate oleh Gemini Flash (~2 detik), lalu hasilnya otomatis tersimpan di tabel `query_cache` Supabase (`"cache_hit": false`).
* **Panggilan ke-2 dengan kalimat mirip (Cache Hit)**: Sistem membaca langsung dari tabel `query_cache` Supabase dengan kemiripan `> 92%` (misal 97.67%), merespon instan dalam hitungan milidetik (`"cache_hit": true`).

---

## 🛡️ 6. Catatan Keamanan & Praktik Terbaik

1. **Jaga Kerahasiaan Password**: File `.env` sudah masuk ke `.gitignore` sehingga password database Supabase tidak akan ter-push ke repository publik.
2. **Koneksi Jaringan**: Karena menggunakan Session Pooler di AWS Singapura (`ap-southeast-1`), latensi koneksi ke server lokal di Indonesia sangat rendah (< 30-50 ms).
3. **Database Maintenance**:
   * Jika sewaktu-waktu ingin mereset bersih tabel di Supabase dan mengulang ID dari 1, cukup panggil:
     `POST http://localhost:8080/documents/reset`
   * Lalu jalankan seeding ulang dengan `POST http://localhost:8080/documents/seed`.
