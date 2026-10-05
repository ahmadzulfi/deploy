# 🗺️ Roadmap & Langkah Pengembangan Selanjutnya (`stepselanjutnya.md`)

Dokumen ini memuat panduan strategis, evaluasi teknis, dan langkah-langkah konkret yang harus dikembangkan agar repositori **`ai-embed`** siap, aman, dan layak diintegrasikan ke dalam **aplikasi utama** sebagai backend *AI & Knowledge Engine* tingkat prototype hingga production.

> [!NOTE]
> **Lingkungan Deployment Aktif:**
> * **Compute / API Engine**: **Vercel (Serverless Go Runtime)**
> * **Database & Vector Store**: **Supabase (Cloud PostgreSQL + `pgvector`)**
> * **AI Model Engine**: **Google Gemini API** (`gemini-embedding-001` & `gemini-2.5-flash-lite`)

---

## 🔍 1. Evaluasi Kondisi Saat Ini (Current State)

### ✅ Hal yang Sudah Baik & Berjalan:
1. **Performa Core Cepat**: Ditulis dalam bahasa Go (Golang) dengan efisiensi memori tinggi.
2. **PostgreSQL Supabase + pgvector (HNSW Cosine Index)**: Indeks modern HNSW untuk pencarian vektor sub-milidetik.
3. **Semantic Query Caching**: Cache semantik dengan threshold $\ge 92\%$, memangkas response time query berulang ke $< 50\text{ ms}$.
4. **Integrasi SDK Resmi Google GenAI**: Mendukung model embedding `gemini-embedding-001` dan LLM cepat `gemini-2.5-flash-lite`.
5. **Format Respons Fleksibel**: Menyediakan output JSON baku untuk web/mobile serta Markdown siap kirim untuk WhatsApp Gateway.

---

### ⚠️ Mengapa Dinilai "Belum Layak" di Lingkungan Vercel + Supabase?

| Celah / Masalah | Dampak Nyata di Vercel & Supabase | Tingkat Bahaya |
| :--- | :--- | :---: |
| **Endpoint Reset Terbuka (`/documents/reset`)** | Siapa pun dari internet bisa memanggil `DROP TABLE CASCADE` dan menghapus bersih seluruh data di Supabase. | **Kritis (P0)** |
| **Tidak Ada Autentikasi / API Key** | Siapa saja bisa melakukan query spamming, menyedot kuota Gemini API dan kuota request Vercel/Supabase (*billing bomb*). | **Kritis (P0)** |
| **Risiko Connection Exhaustion Supabase** | Vercel me-scale serverless function secara otomatis. Jika koneksi database tidak memakai *Supabase Connection Pooler* (port 6543 / Supavisor), pool koneksi Supabase akan cepat jebol (`FATAL: remaining connection slots are reserved`). | **Kritis (P0)** |
| **Vercel Serverless Timeout (10–15s)** | Upload file besar atau seeding 100 data dalam 1 HTTP request akan memicu `504 Gateway Timeout` karena limit eksekusi Vercel Hobby. | **Tinggi (P1)** |
| **Stale Cache (Data Basi)** | Saat dokumen SOP diedit atau dihapus, riwayat di `query_cache` Supabase tidak terhapus. User tetap mendapat jawaban lama. | **Tinggi (P1)** |
| **Tidak Ada Document Chunking** | 1 Dokumen = 1 Vektor. SOP panjang (> 800 kata) akan kehilangan informasi spesifik dan detail penting saat di-embed. | **Tinggi (P1)** |
| **Tidak Ada Rejection Guardrail** | Pertanyaan ngawur (di luar SOP) tetap dipaksakan menjawab dokumen terdekat, memicu halusinasi AI. | **Tinggi (P1)** |
| **Keterbatasan Background Goroutine di Vercel** | Di Vercel Serverless, proses `go func()` di background akan dibekukan (*frozen/terminated*) segera setelah response HTTP dikembalikan. Webhook WA butuh penanganan khusus. | **Sedang (P2)** |
| **Stateless (Tanpa Session Chat)** | Bot belum memiliki memori percakapan berantai (*multi-turn conversation*). | **Sedang (P2)** |

---

## 🏗️ 2. Arsitektur Target di Vercel + Supabase

```mermaid
flowchart TD
    subgraph Client ["Client Layer"]
        App["Aplikasi Utama (Web / Mobile)"]
        WAGateway["WhatsApp Gateway"]
    end

    subgraph Vercel ["Vercel Serverless (ai-embed)"]
        AuthMid["Auth Middleware (X-API-Key)"]
        RateLimiter["Rate Limiter"]
        Router["Go HTTP Handlers"]
        Guardrail["Guardrail & Similarity Cutoff"]
        Chunker["Document Chunker Engine"]
        CacheMgr["Semantic Cache & Invalidation"]
    end

    subgraph SupabaseCloud ["Supabase Cloud"]
        Pooler["Supavisor Connection Pooler (Port 6543)"]
        PG[("PostgreSQL\n(pgvector HNSW + pg_trgm)")]
        Pooler --> PG
    end

    subgraph AICloud ["Google Cloud"]
        GeminiAPI["Gemini Embedding & LLM"]
    end

    App -->|X-API-Key| AuthMid
    WAGateway -->|Webhook Secret| AuthMid
    AuthMid --> RateLimiter
    RateLimiter --> Router

    Router --> Guardrail
    Router --> Chunker
    Router --> CacheMgr

    Guardrail --> Pooler
    Guardrail --> GeminiAPI
    Chunker --> Pooler
    CacheMgr --> Pooler
```

---

## 🚀 3. Roadmap Langkah Pengembangan Bertahap

### 🔴 FASE 1: Keamanan & Penyesuaian Serverless (P0 - Wajib Sebelum Integrasi)

#### 1.1. Proteksi / Matikan Endpoint Reset Database
* **Masalah**: Endpoint `POST /documents/reset` menghapus tabel dan indeks Supabase secara langsung.
* **Solusi**:
  * Matikan rute `/documents/reset` pada lingkungan production, ATAU
  * Wajibkan header `X-Admin-Secret` yang cocok dengan environment variable Vercel:
    ```go
    if r.Header.Get("X-Admin-Secret") != os.Getenv("ADMIN_SECRET_KEY") {
        WriteError(w, http.StatusForbidden, "Akses ditolak: Hanya untuk super admin")
        return
    }
    ```

#### 1.2. Amankan API dengan API Key Middleware
* Hanya aplikasi utama dan bot resmi yang boleh memanggil API `ai-embed`.
* Buat middleware pengecekan header `X-API-Key`:
  ```go
  func APIKeyMiddleware(next http.Handler) http.Handler {
      return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
          if r.URL.Path == "/" || r.URL.Path == "/health" {
              next.ServeHTTP(w, r)
              return
          }
          clientKey := r.Header.Get("X-API-Key")
          if clientKey == "" || clientKey != os.Getenv("APP_API_KEY") {
              WriteError(w, http.StatusUnauthorized, "Unauthorized: API Key tidak valid")
              return
          }
          next.ServeHTTP(w, r)
      })
  }
  ```

#### 1.3. Optimasi Koneksi Supabase untuk Serverless Vercel
* **Masalah**: Direct connection `postgresql://postgres:...@db.xxx.supabase.co:5432/postgres` membuka koneksi baru setiap kali Vercel function melakukan cold-start / scale-out, menyebabkan kuota koneksi Supabase habis (*max connections reached*).
* **Solusi**:
  1. Gunakan **Supabase Transaction Pooler URL** (port `6543`) di `DATABASE_URL` Vercel:
     `postgresql://postgres.xxx:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
  2. Batasi connection pool di `db.go`:
     ```go
     config.MaxConns = 2 // Jangan pasang pool besar di serverless function!
     config.MinConns = 0
     config.MaxConnIdleTime = 15 * time.Second
     ```
  3. Matikan pengecekan `EnsureDatabaseAndExtension` yang mencoba konek ke database `postgres` default saat runtime Vercel, karena menambah delay cold-start dan user Supabase tidak berhak menjalankan `CREATE DATABASE`.

#### 1.4. Guardrail Rejection Cutoff (Mencegah Halusinasi)
* Jika pertanyaan user tidak ada sangkut pautnya dengan SOP layanan:
  * Atur cutoff: jika `best_similarity < 0.60` (60%), **jangan panggil LLM Gemini** (menghemat kuota dan memangkas waktu tunggu).
  * Kembalikan pesan default:
    > *"Mohon maaf, informasi terkait pertanyaan Anda tidak ditemukan dalam SOP layanan kami. Silakan ajukan pertanyaan lain seputar layanan publik."*

---

### 🟠 FASE 2: RAG Pipeline & Chunking Dokumen (P1)

#### 2.1. Document Chunking (SOP Panjang Tidak Boleh 1 Vektor)
* Jika dokumen SOP memiliki 3–10 halaman, meng-embed seluruh teks sekaligus akan membuat pencarian tidak akurat.
* **Solusi Struktur Tabel di Supabase**:
  ```sql
  -- Metadata Dokumen Induk
  CREATE TABLE documents (
      id SERIAL PRIMARY KEY,
      category VARCHAR(100) NOT NULL,
      title VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Potongan Teks & Vektor (Chunks)
  CREATE TABLE document_chunks (
      id SERIAL PRIMARY KEY,
      document_id INT REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INT NOT NULL,
      content TEXT NOT NULL,
      embedding VECTOR(768) NOT NULL
  );
  CREATE INDEX ON document_chunks USING hnsw (embedding vector_cosine_ops);
  ```
* Potong dokumen dengan panjang **500–800 karakter** dan **overlap 100 karakter** sebelum disimpan.

#### 2.2. Batch Ingestion yang Ramah Timeout Vercel
* Karena Vercel memiliki batas timeout 10–15 detik, jangan melakukan seeding/insert 100 dokumen dalam 1 request HTTP.
* Pecah proses upload menjadi batch kecil (maksimal 5–10 dokumen per request) atau buat script seeder lokal via CLI yang langsung menembak Supabase.

---

### 🟡 FASE 3: Manajemen Cache & Kesegaran Data (P1)

#### 3.1. Invalidate Cache Otomatis saat Update/Delete Dokumen
* Setiap kali admin melakukan `PUT /documents/{id}` atau `DELETE /documents/{id}`:
  * Otomatis jalankan pembersihan pada tabel `query_cache` di Supabase untuk query yang mereferensikan dokumen tersebut.
  * Tambahkan endpoint: `DELETE /cache` (hanya admin) untuk membersihkan seluruh semantic cache jika terjadi pembaruan SOP massal.

#### 3.2. Expired At / TTL pada Query Cache
* Tambahkan kolom `expires_at` (misal 14 atau 30 hari).
* Query cache yang sudah melewati batas waktu akan otomatis diabaikan sehingga jawaban AI diperbarui dengan konteks terbaru.

---

### 🟢 FASE 4: WhatsApp Webhook & Multi-Turn Chatbot (P2)

#### 4.1. Strategi Webhook di Lingkungan Vercel Serverless
* **Catatan Khusus Vercel**: Karena serverless function langsung mati setelah response dikembalikan, kita **tidak bisa** menjalankan `go func()` background yang memakan waktu lama setelah response dikirim.
* **Dua Solusi yang Layak Digunakan**:
  1. **Fast-Sync Reply**: Karena kita sudah mengoptimalkan latency dengan Gemini Flash-Lite (~1.5s - 2s) dan Semantic Cache (< 50ms), respon sinkron masih aman dalam batas timeout Vercel (10 detik) dan timeout WA Gateway (biasanya 5–10 detik).
  2. **External Queue (Jika butuh async penuh)**: Gunakan layanan seperti **Upstash QStash** atau **Supabase Edge Functions** untuk menerima webhook secara instan lalu mendispatch tugas ke serverless worker.

#### 4.2. Session Memory (Percakapan Berkelanjutan)
* Simpan riwayat percakapan 3 chat terakhir berdasarkan nomor pengirim (`sender`) di tabel Supabase `chat_sessions`.
* Jika pengguna bertanya pertanyaan lanjutan (*"Kalau untuk anak di bawah umur bagaimana?"*), sistem menyertakan konteks percakapan sebelumnya ke prompt Gemini.

---

### 🔵 FASE 5: Integrasi ke Aplikasi Utama (Frontend/Backend)

#### 5.1. Response Metadata yang Lengkap
* Pastikan response endpoint `/documents/search` menyertakan:
  * `latency_ms`: Waktu pemrosesan query (untuk monitoring performa aplikasi utama).
  * `sources`: Daftar dokumen SOP yang dijadikan referensi (judul, link berkas, kategori, persentase kemiripan).

#### 5.2. Multi-Tenancy (Dukungan Banyak Instansi/Divisi)
* Tambahkan kolom `tenant_id` pada tabel `documents` di Supabase agar aplikasi utama dapat membatasi pencarian hanya untuk dokumen milik divisi atau instansi tertentu.

---

## 📋 4. Matrix Prioritas Implementasi

| No | Tugas / Fitur | Target Platform | Estimasi | Prioritas |
| :---: | :--- | :--- | :---: | :---: |
| 1 | **Kunci `/documents/reset` & Pasang API Key** | Vercel Env + Go Middleware | 30 Menit | **P0** |
| 2 | **Gunakan Supabase Connection Pooler (Port 6543)** | Supabase & Vercel Env | 15 Menit | **P0** |
| 3 | **Pasang Similarity Cutoff (Guardrail Anti-Halusinasi)** | Go Controller | 30 Menit | **P0** |
| 4 | **Cache Invalidation saat Update/Delete Dokumen** | Go + Supabase | 1 Jam | **P1** |
| 5 | **Chunking Dokumen Panjang (SOP Detail)** | Go + Supabase `pgvector` | 3–4 Jam | **P1** |
| 6 | **Pencegahan Timeout Vercel saat Ingestion Dokumen** | Go Batching Handler | 1–2 Jam | **P1** |
| 7 | **Multi-turn Memory Percakapan WhatsApp** | Supabase Table `chat_sessions` | 2–3 Jam | **P2** |
| 8 | **Multi-Tenancy (`tenant_id`)** | Supabase + Query Filtering | 1–2 Jam | **P2** |

---

## 🏁 Rekomendasi Langkah Pertama (Sprint Cepat Hari Ini)

Untuk langsung membuat sistem ini **aman dan layak diuji coba oleh aplikasi utama Anda hari ini**, lakukan 3 langkah ini terlebih dahulu:
1. **Set Environment Variable di Vercel**:
   * `APP_API_KEY`: Kunci rahasia agar hanya aplikasi utama Anda yang bisa memanggil endpoint.
   * `DATABASE_URL`: Pastikan memakai URL **Supabase Pooler** (port 6543).
2. **Pasang API Key Middleware** di rute Go untuk memblokir akses publik liar.
3. **Kunci rute `/documents/reset`** agar database Supabase Anda terlindungi dari bahaya terhapus.
