# Dokumentasi Arsitektur Folder `controller/`

Dokumen ini menjelaskan struktur, tanggung jawab, dan rincian teknis dari setiap file yang berada di dalam folder [`controller/`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller).

---

## 📌 Ringkasan Arsitektur

Package `controller` mengadopsi prinsip **Single Responsibility** dan **Modularitas**. Setiap tindakan / fungsionalitas CRUD dan fitur pendukung dipisahkan ke dalam file tersendiri, namun tetap berada dalam satu package `controller` dan berbagi struct controller yang sama ([`DocumentController`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/document_controller.go#L10-L13)).

### Keuntungan Pemisahan File:
1. **Maintainability**: Memudahkan penelusuran kode tanpa harus menelusuri ratusan baris kode dalam satu file monolitik.
2. **Readability**: Logika bisnis per endpoint jelas terisolasi.
3. **Kolaborasi Tim**: Mengurangi potensi *git merge conflict* saat beberapa developer mengerjakan fitur yang berbeda.
4. **Dependency Injection**: Koneksi database (`*pgxpool.Pool`) dan AI client (`*embedding.GeminiEmbedder`) diinjeksi sekali saat inisialisasi di [`main.go`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/main.go).

---

## 🗂️ Peta File & Tanggung Jawab

| File | Deskripsi Utama | Endpoint / Method |
| :--- | :--- | :--- |
| [document_controller.go](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/document_controller.go) | Struct controller, constructor, routing, & root info | `GET /` |
| [create.go](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/create.go) | Operasi penambahan dokumen baru & auto-generate embedding | `POST /documents` |
| [read.go](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/read.go) | Operasi pembacaan data dokumen (semua & by ID) | `GET /documents`<br>`GET /documents/{id}` |
| [update.go](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/update.go) | Operasi pembaruan dokumen & regenerasi embedding vector | `PUT /documents/{id}` |
| [delete.go](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/delete.go) | Operasi penghapusan dokumen | `DELETE /documents/{id}` |
| [search.go](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/search.go) | Pencarian semantik & AI Feedback Assistant (RAG respon cerdas) | `POST /documents/search`<br>`GET /documents/search` |
| [seed.go](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/seed.go) | Reset tabel database dan auto-seeding 100 data dummy SOP Layanan Publik | `POST /documents/reset`<br>`POST /documents/seed` |
| [response.go](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/response.go) | Helper fungsi respon JSON standar dan error handling | Utility / Helpers |

---

## 🔍 Penjelasan Detail Tiap File

### 1. [`document_controller.go`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/document_controller.go)
File ini bertindak sebagai **fondasi utama** controller.
- **Definisi Struct `DocumentController`**:
  ```go
  type DocumentController struct {
      pool     *pgxpool.Pool
      embedder *embedding.GeminiEmbedder
  }
  ```
  Menyimpan dependensi pool database PostgreSQL dan klien Gemini AI.
- **Constructor `NewDocumentController(pool, embedder)`**:
  Fungsi factory untuk membuat instance controller baru.
- **Method `RegisterRoutes(mux *http.ServeMux)`**:
  Mendaftarkan seluruh rute endpoint API ke HTTP ServeMux (menggunakan fitur routing Go 1.22+ dengan method prefix seperti `"POST /documents"`).
- **`HandleRoot` (`GET /`)**:
  Menampilkan informasi status API beserta daftar endpoint yang tersedia dalam format JSON.
- **Shared DTO `DocumentRequest`**:
  Struct request yang digunakan oleh handler create, update, dan seeding.

---

### 2. [`create.go`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/create.go)
Menangani penambahan dokumen baru.
- **Handler**: `HandleCreateDocument(w http.ResponseWriter, r *http.Request)`
- **Route**: `POST /documents`
- **Alur Kerja**:
  1. Decode request body JSON ke dalam struct `DocumentRequest`.
  2. Validasi input: memastikan `title` dan `content` tidak kosong, serta memberi nilai default `"Umum"` jika `category` tidak diisi.
  3. Menggabungkan kategori dan judul sebagai konteks embedding (`[Kategori] Judul`).
  4. Menghubungi API Gemini via `c.embedder.GenerateDocumentEmbedding` untuk menghasilkan vektor 768 dimensi.
  5. Menyimpan data teks beserta vektor ke PostgreSQL via `db.InsertDocument`.
  6. Mengembalikan respon HTTP `201 Created` dengan informasi ID dokumen dan dimensi vektor.

---

### 3. [`read.go`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/read.go)
Menangani pembacaan dokumen.
- **Handler 1**: `HandleGetAllDocuments(w http.ResponseWriter, r *http.Request)`
  - **Route**: `GET /documents`
  - **Query Params**: `limit` (default: 50), `offset` (default: 0).
  - Mengambil data list dokumen tanpa menyertakan raw vector (agar hemat bandwidth) serta menghitung total data (`total`).
- **Handler 2**: `HandleGetDocumentByID(w http.ResponseWriter, r *http.Request)`
  - **Route**: `GET /documents/{id}`
  - Mengambil ID dari path parameter via `r.PathValue("id")`.
  - Jika ID tidak valid (bukan angka), mengembalikan HTTP `400 Bad Request`.
  - Jika dokumen tidak ditemukan, mengembalikan HTTP `404 Not Found`.

---

### 4. [`update.go`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/update.go)
Menangani pembaruan data dokumen yang sudah ada.
- **Handler**: `HandleUpdateDocument(w http.ResponseWriter, r *http.Request)`
- **Route**: `PUT /documents/{id}`
- **Alur Kerja**:
  1. Mengambil parameter ID dari URL.
  2. Parse dan validasi payload JSON baru (`category`, `title`, `content`).
  3. Memanggil Gemini untuk membuat ulang vektor embedding baru dari konten yang sudah diperbarui.
  4. Memperbarui record di database via `db.UpdateDocument`.
  5. Mengembalikan HTTP `200 OK` dengan metadata pembaruan.

---

### 5. [`delete.go`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/delete.go)
Menangani penghapusan dokumen.
- **Handler**: `HandleDeleteDocument(w http.ResponseWriter, r *http.Request)`
- **Route**: `DELETE /documents/{id}`
- **Alur Kerja**:
  1. Mengambil ID dari parameter path URL.
  2. Menghapus record dokumen di database via `db.DeleteDocument`.
  3. Mengembalikan pesan sukses penghapusan dalam format JSON.

---

### 6. [`search.go`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/search.go)
Menangani **Pencarian Semantik & Umpan Balik AI (RAG / AI Feedback Assistant)**.
Bukan sekadar mengembalikan data mentah hasil pencarian vektor, endpoint ini menghasilkan **umpan balik cerdas (AI feedback)** untuk membalas pertanyaan atau keluhan pengguna berdasarkan dokumen referensi dengan skor kemiripan tertinggi.
- **Handler**: `HandleSemanticSearch(w http.ResponseWriter, r *http.Request)`
- **Route**: `POST /documents/search` dan `GET /documents/search`
- **Output Response AI Feedback**:
  - `related_service`: Menyebutkan nama layanan atau produk terkait secara spesifik.
  - `category`: Kategori layanan.
  - `short_description`: Inisiatif respon cepat AI (1-2 kalimat) yang ramah, langsung menanggapi keluhan/pertanyaan, dan menyebutkan produk/layanan terkait.
  - `long_summary`: Rangkuman deskripsi panjang solusi lengkap, alur/prosedur yang harus dijalani, syarat berkas yang diperlukan, serta tempat atau pihak yang harus dihubungi.
  - `best_similarity` & `best_similarity_percentage`: Skor kecocokan tertinggi dari pgvector.
  - `matched_sources`: Daftar dokumen referensi teratas yang dijadikan dasar analisis AI.
- **Alur Kerja**:
  1. Menerima teks pertanyaan atau keluhan via body JSON (`query`) atau query parameter (`?q=`).
  2. Mengonversi teks query menjadi vektor 768 dimensi via `c.embedder.GenerateQueryEmbedding` (`RETRIEVAL_QUERY`).
  3. **Pengecekan Semantic Cache**: Memeriksa tabel `query_cache` apakah sudah pernah ada pertanyaan sebelumnya dengan kemiripan semantik $\ge 0.92$ (92%).
     - **Cache Hit**: Jika ditemukan, update `hit_count` dan langsung kembalikan feedback serta matched sources dari cache (sangat cepat, menghemat kuota LLM & latensi < 20ms).
     - **Cache Miss**: Lanjut ke langkah pencarian dokumen master.
  4. Mencari dokumen terdekat di tabel `documents` menggunakan operator cosine distance (`<=>`).
  5. Mengambil dokumen teratas dengan skor kemiripan tertinggi sebagai basis konteks.
  6. Memanggil Gemini LLM (`c.embedder.GenerateFeedback`) untuk merumuskan respon inisiatif pendek dan deskripsi panjang terangkum.
  7. Menyimpan query, vektor embedding, dan respon feedback ke tabel `query_cache`.
  8. Mengembalikan JSON umpan balik lengkap kepada pengguna.

---

### 7. [`seed.go`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/seed.go)
Menangani pemeliharaan database dan pengisian data uji.
- **Handler 1**: `HandleResetDatabase`
  - **Route**: `POST /documents/reset`
  - Mengosongkan tabel `documents` (`TRUNCATE`) dan mereset nilai auto-increment sequence kembali ke 1 via `db.ResetDatabase`.
- **Handler 2**: `HandleSeedDatabase`
  - **Route**: `POST /documents/seed`
  - Membaca file [`dummy_data.json`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/dummy_data.json) (mendukung format wrapper object `{"data": [...]}`).
  - Melakukan iterasi 100 data SOP Layanan Publik, meng-generate vector embedding dengan jeda rate-limit dan auto-retry, serta menyimpannya ke database.

---

### 8. [`response.go`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller/response.go)
Menyediakan fungsi utility pembantu untuk konsistensi respon HTTP JSON di seluruh controller:
- **`WriteJSON(w http.ResponseWriter, status int, data any)`**:
  Mengatur header `Content-Type: application/json`, status code HTTP, dan melakukan encode JSON.
- **`WriteError(w http.ResponseWriter, status int, message string)`**:
  Standarisasi format pesan error:
  ```json
  {
    "status": "error",
    "message": "pesan error di sini"
  }
  ```

---

## 🚀 Cara Penggunaan di `main.go`

Inisialisasi controller di [main.go](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/main.go) menjadi sangat ringkas:

```go
mux := http.NewServeMux()

// 1. Inisialisasi controller dengan dependency database & AI embedder
docController := controller.NewDocumentController(pool, embedder)

// 2. Daftarkan seluruh rute sekaligus
docController.RegisterRoutes(mux)

// 3. Jalankan HTTP server
http.ListenAndServe(addr, enableCORS(mux))
```
