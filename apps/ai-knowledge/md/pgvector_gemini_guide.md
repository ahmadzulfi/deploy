# Panduan Lengkap CRUD PostgreSQL pgvector & Gemini Embedding di Go

Panduan ini membahas arsitektur, cara kerja, implementasi fungsi CRUD (Create, Read, Update, Delete), pencarian semantik vektor (*Semantic Search*), integrasi model **Google Gemini Embedding** (`gemini-embedding-001`), serta contoh request dan response lengkap di **Postman**.

---

## 📑 Daftar Isi
1. [Arsitektur & Konsep Alur Kerja](#1-arsitektur--konsep-alur-kerja)
2. [Konfigurasi pgvector di PostgreSQL & Go](#2-konfigurasi-pgvector-di-postgresql--go)
3. [Integrasi Gemini Embedding di Go](#3-integrasi-gemini-embedding-di-go)
4. [Implementasi Kode CRUD & Search](#4-implementasi-kode-crud--search)
   - [Create (Insert Dokumen & Vector)](#create-insert-dokumen)
   - [Read (Ambil Semua & Berdasarkan ID)](#read-ambil-dokumen)
   - [Update (Perbarui Konten & Re-generate Vector)](#update-perbarui-dokumen)
   - [Delete (Hapus Dokumen)](#delete-hapus-dokumen)
   - [Semantic Search (Cosine Distance)](#semantic-search-pencarian-vektor)
   - [Reset & Seed Database](#reset--seed-database)
5. [Contoh Request & Output Response di Postman](#5-contoh-request--output-response-di-postman)
6. [Best Practice & Tips Optimasi](#6-best-practice--tips-optimasi)

---

## 1. Arsitektur & Konsep Alur Kerja

Dalam aplikasi ini, data teks tidak hanya disimpan sebagai teks biasa, melainkan juga dikonversi menjadi representasi vektor numerik (*high-dimensional vector*) menggunakan model embedding AI.

```
+---------------------------------------------------------------------------------+
|                                 ALUR KERJA (WORKFLOW)                           |
+---------------------------------------------------------------------------------+

  [Client / Postman]
         |
         | 1. HTTP Request (JSON Body: title, content, category)
         v
  [Go REST API Handler]
         |
         | 2. Kirim Teks Dokumen
         v
  [Google Gemini API] ---- (Model: gemini-embedding-001, Task: RETRIEVAL_DOCUMENT)
         |
         | 3. Respon Vektor 768 Dimensi [0.0123, -0.0456, 0.0789, ...]
         v
  [PostgreSQL + pgvector]
         |
         | 4. INSERT INTO documents (title, content, embedding)
         v
  [Tersimpan di Tabel dengan Index HNSW]
```

Ketika user melakukan **Pencarian Semantik (Semantic Search)**:
1. User mengirim query pencarian (misal: `"mamalia darat berbelalai"`).
2. Server meminta Gemini membuat vektor query menggunakan task `RETRIEVAL_QUERY`.
3. PostgreSQL menghitung jarak sudut (*Cosine Distance* `<=>`) antara vektor query dan seluruh vektor dokumen yang tersimpan.
4. Dokumen dengan kemiripan tertinggi dikembalikan ke user, meskipun tidak mengandung kata kunci persis (*exact keyword*).

---

## 2. Konfigurasi pgvector di PostgreSQL & Go

### A. Tabel Database & Index HNSW
Ekstensi `vector` diaktifkan dan tabel didefinisikan dengan tipe `VECTOR(768)` sesuai dimensi Gemini Embedding:

```sql
-- 1. Aktifkan ekstensi pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Buat tabel documents
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    category VARCHAR(100) NOT NULL DEFAULT 'Umum',
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(768) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Buat Index HNSW (Hierarchical Navigable Small World) untuk pencarian cepat
CREATE INDEX IF NOT EXISTS documents_embedding_idx 
ON documents USING hnsw (embedding vector_cosine_ops);
```

### B. Registrasi Tipe Data `pgvector` di Driver `pgx/v5`
Driver Go PostgreSQL `pgx/v5` memerlukan registrasi tipe data pgvector agar struct `pgvector.Vector` dapat di-encode dan di-decode secara otomatis:

```go
package db

import (
	"context"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgxvec "github.com/pgvector/pgvector-go/pgx"
)

func Connect(ctx context.Context, connStr string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return nil, err
	}

	// Registrasi pgvector ke setiap koneksi baru di pool
	config.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		return pgxvec.Register(conn)
	}

	return pgxpool.NewWithConfig(ctx, config)
}
```

---

## 3. Integrasi Gemini Embedding di Go

Menggunakan SDK resmi `google.golang.org/genai` dan package `github.com/pgvector/pgvector-go`.

### A. Inisialisasi Klien Gemini
```go
package embedding

import (
	"context"
	"google.golang.org/genai"
)

type GeminiEmbedder struct {
	client    *genai.Client
	model     string
	dimension int32
}

func NewGeminiEmbedder(ctx context.Context, apiKey, modelName string) (*GeminiEmbedder, error) {
	if modelName == "" {
		modelName = "gemini-embedding-001"
	}

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, err
	}

	return &GeminiEmbedder{
		client:    client,
		model:     modelName,
		dimension: 768, // 768 dimensi sesuai VECTOR(768) di database
	}, nil
}
```

### B. Asymmetric Embedding: Dokumen vs Query
Model embedding modern bekerja optimal jika membedakan antara embedding dokumen yang disimpan (*Document Embedding*) dan kalimat pertanyaan user (*Query Embedding*):

#### 1. Untuk Dokumen (`RETRIEVAL_DOCUMENT`):
```go
func (e *GeminiEmbedder) GenerateDocumentEmbedding(ctx context.Context, title, content string) (pgvector.Vector, error) {
	dim := e.dimension
	res, err := e.client.Models.EmbedContent(ctx, e.model, []*genai.Content{
		{
			Parts: []*genai.Part{
				{Text: content},
			},
		},
	}, &genai.EmbedContentConfig{
		OutputDimensionality: &dim,
		TaskType:             "RETRIEVAL_DOCUMENT",
		Title:                title, // Judul memberi bobot konteks tambahan
	})
	if err != nil {
		return pgvector.Vector{}, err
	}

	// Konversi float32 slice ke pgvector.Vector
	return pgvector.NewVector(res.Embeddings[0].Values), nil
}
```

#### 2. Untuk Pencarian / Query (`RETRIEVAL_QUERY`):
```go
func (e *GeminiEmbedder) GenerateQueryEmbedding(ctx context.Context, query string) (pgvector.Vector, error) {
	dim := e.dimension
	res, err := e.client.Models.EmbedContent(ctx, e.model, []*genai.Content{
		{
			Parts: []*genai.Part{
				{Text: query},
			},
		},
	}, &genai.EmbedContentConfig{
		OutputDimensionality: &dim,
		TaskType:             "RETRIEVAL_QUERY",
	})
	if err != nil {
		return pgvector.Vector{}, err
	}

	return pgvector.NewVector(res.Embeddings[0].Values), nil
}
```

---

## 4. Implementasi Kode CRUD & Search

Berikut implementasi kode database ([`db/db.go`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/db/db.go)) dan controller ([`controller/`](file:///c:/Tugas%20Kuliah/intership%201/go-pgvector-gemini/controller)):

### Create: Insert Dokumen
Menyimpan teks dan embedding vektor ke PostgreSQL:

```go
// [db/db.go]
func InsertDocument(ctx context.Context, pool *pgxpool.Pool, category, title, content string, embedding pgvector.Vector) (int, error) {
	query := `
		INSERT INTO documents (category, title, content, embedding)
		VALUES ($1, $2, $3, $4)
		RETURNING id;
	`
	var id int
	err := pool.QueryRow(ctx, query, category, title, content, embedding).Scan(&id)
	return id, err
}

// [controller/create.go]
func (c *DocumentController) HandleCreateDocument(w http.ResponseWriter, r *http.Request) {
	var req DocumentRequest
	json.NewDecoder(r.Body).Decode(&req)

	// 1. Generate Vector melalui Gemini
	titleWithCat := fmt.Sprintf("[%s] %s", req.Category, req.Title)
	vec, err := c.embedder.GenerateDocumentEmbedding(r.Context(), titleWithCat, req.Content)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "Gagal generate embedding")
		return
	}

	// 2. Simpan ke database
	id, err := db.InsertDocument(r.Context(), c.pool, req.Category, req.Title, req.Content, vec)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "Gagal insert database")
		return
	}

	WriteJSON(w, http.StatusCreated, map[string]any{
		"status":  "success",
		"message": "Dokumen berhasil disimpan dan vector embedding otomatis dibuat",
		"data": map[string]any{
			"id":                  id,
			"category":            req.Category,
			"title":               req.Title,
			"content":             req.Content,
			"embedding_dimension": len(vec.Slice()),
		},
	})
}
```

---

### Read: Ambil Dokumen
Membaca data dokumen (tanpa menyertakan raw array 768 vektor agar hemat payload jaringan):

```go
// [db/db.go] Ambil Semua dengan Pagination
func GetAllDocuments(ctx context.Context, pool *pgxpool.Pool, limit, offset int) ([]DocumentResponse, error) {
	query := `
		SELECT id, category, title, content, created_at
		FROM documents
		ORDER BY id ASC
		LIMIT $1 OFFSET $2;
	`
	rows, err := pool.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var docs []DocumentResponse
	for rows.Next() {
		var doc DocumentResponse
		rows.Scan(&doc.ID, &doc.Category, &doc.Title, &doc.Content, &doc.CreatedAt)
		docs = append(docs, doc)
	}
	return docs, nil
}

// [db/db.go] Ambil Berdasarkan ID
func GetDocumentByID(ctx context.Context, pool *pgxpool.Pool, id int) (*DocumentResponse, error) {
	query := `
		SELECT id, category, title, content, created_at
		FROM documents
		WHERE id = $1;
	`
	var doc DocumentResponse
	err := pool.QueryRow(ctx, query, id).Scan(&doc.ID, &doc.Category, &doc.Title, &doc.Content, &doc.CreatedAt)
	return &doc, err
}
```

---

### Update: Perbarui Dokumen
Saat konten atau judul dokumen berubah, vektor embedding **harus di-generate ulang** agar pencarian semantik tetap akurat:

```go
// [db/db.go]
func UpdateDocument(ctx context.Context, pool *pgxpool.Pool, id int, category, title, content string, embedding pgvector.Vector) error {
	query := `
		UPDATE documents
		SET category = $1, title = $2, content = $3, embedding = $4
		WHERE id = $5;
	`
	cmd, err := pool.Exec(ctx, query, category, title, content, embedding, id)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return fmt.Errorf("dokumen tidak ditemukan")
	}
	return nil
}
```

---

### Delete: Hapus Dokumen
Menghapus baris dokumen beserta kolom vektornya:

```go
// [db/db.go]
func DeleteDocument(ctx context.Context, pool *pgxpool.Pool, id int) error {
	query := `DELETE FROM documents WHERE id = $1;`
	cmd, err := pool.Exec(ctx, query, id)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return fmt.Errorf("dokumen dengan ID %d tidak ditemukan", id)
	}
	return nil
}
```

---

### Semantic Search: Pencarian Vektor
Pencarian kemiripan menggunakan operator `<=>` (Cosine Distance) di PostgreSQL pgvector:
- Jarak Cosine bernilai antara `0.0` (identik) hingga `2.0` (berlawanan arah).
- Nilai Kemiripan (*Cosine Similarity*) dihitung dengan rumus: `Similarity = 1 - (embedding <=> queryVec)`. Semakin mendekati `1.0` (atau 100%), artinya dokumen semakin mirip.

```go
// [db/db.go]
func SearchSimilar(ctx context.Context, pool *pgxpool.Pool, queryVec pgvector.Vector, limit int) ([]SearchResult, error) {
	query := `
		SELECT id, category, title, content, 1 - (embedding <=> $1) AS similarity
		FROM documents
		ORDER BY embedding <=> $1 ASC
		LIMIT $2;
	`
	rows, err := pool.Query(ctx, query, queryVec, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var item SearchResult
		rows.Scan(&item.ID, &item.Category, &item.Title, &item.Content, &item.Similarity)
		results = append(results, item)
	}
	return results, nil
}
```

---

### Reset & Seed Database
- **Reset**: Mengosongkan tabel `documents` via `TRUNCATE / DROP` dan mereset auto-increment sequence kembali ke `1`.
- **Seed**: Membaca file JSON dummy (`dummy_data.json`), meng-embed masing-masing item melalui Gemini, dan memasukkannya ke database.

---

## 5. Contoh Request & Output Response di Postman

Berikut panduan langkah demi langkah saat melakukan testing menggunakan Postman pada dataset **100 SOP Layanan Publik**.

---

### 1. Create Document (Tambah Dokumen Baru)
Otomatis meng-generate embedding vektor 768 dimensi via Gemini dan menyimpannya ke database PostgreSQL.

- **Method**: `POST`
- **URL**: `http://localhost:8080/documents`
- **Headers**:
  ```http
  Content-Type: application/json
  ```
- **Body (raw JSON)**:
  ```json
  {
    "category": "Kependudukan",
    "title": "Penerbitan Surat Pindah Domisili Online",
    "content": "Pelayanan pengajuan surat keterangan pindah antar kabupaten secara daring melalui aplikasi kependudukan daerah tanpa harus antre di kantor disdukcapil."
  }
  ```
- **Response Status**: `201 Created`
- **Response Body**:
  ```json
  {
    "data": {
      "category": "Kependudukan",
      "content": "Pelayanan pengajuan surat keterangan pindah antar kabupaten secara daring melalui aplikasi kependudukan daerah tanpa harus antre di kantor disdukcapil.",
      "embedding_dimension": 768,
      "id": 101,
      "title": "Penerbitan Surat Pindah Domisili Online"
    },
    "message": "Dokumen berhasil disimpan dan vector embedding otomatis dibuat",
    "status": "success"
  }
  ```

---

### 2. Read All Documents (Ambil Semua Dokumen)
Mendukung pagination query parameter `limit` dan `offset` pada 100 data yang tersimpan.

- **Method**: `GET`
- **URL**: `http://localhost:8080/documents?limit=2&offset=0`
- **Response Status**: `200 OK`
- **Response Body**:
  ```json
  {
    "data": [
      {
        "category": "Kependudukan",
        "content": "Perekaman biometrik sidik jari, iris mata, dan foto wajah untuk warga negara yang telah genap berusia 17 tahun atau sudah menikah dengan membawa fotokopi KK ke kantor kecamatan.",
        "created_at": "2026-09-20T08:00:00Z",
        "id": 1,
        "title": "Penerbitan KTP Elektronik Baru Pemula Usia 17 Tahun"
      },
      {
        "category": "Kependudukan",
        "content": "Pelayanan pencetakan ulang blangko kartu tanda penduduk yang rusak secara fisik, chip tidak terbaca, atau foto memudar tanpa perlu perekaman sidik jari ulang.",
        "created_at": "2026-09-20T08:05:00Z",
        "id": 2,
        "title": "Penggantian e-KTP Rusak, Buram, atau Patah"
      }
    ],
    "limit": 2,
    "offset": 0,
    "status": "success",
    "total": 100
  }
  ```

---

### 3. Read Document by ID (Ambil Dokumen Spesifik)
- **Method**: `GET`
- **URL**: `http://localhost:8080/documents/1`
- **Response Status**: `200 OK`
- **Response Body**:
  ```json
  {
    "data": {
      "category": "Kependudukan",
      "content": "Perekaman biometrik sidik jari, iris mata, dan foto wajah untuk warga negara yang telah genap berusia 17 tahun atau sudah menikah dengan membawa fotokopi KK ke kantor kecamatan.",
      "created_at": "2026-09-20T08:00:00Z",
      "id": 1,
      "title": "Penerbitan KTP Elektronik Baru Pemula Usia 17 Tahun"
    },
    "status": "success"
  }
  ```

---

### 4. Update Document (Perbarui Dokumen)
Saat mengupdate dokumen, Gemini secara otomatis membuat ulang (*re-generate*) vektor embedding baru dari judul dan konten yang baru.

- **Method**: `PUT`
- **URL**: `http://localhost:8080/documents/1`
- **Headers**:
  ```http
  Content-Type: application/json
  ```
- **Body (raw JSON)**:
  ```json
  {
    "category": "Kependudukan",
    "title": "Penerbitan KTP Elektronik Baru Pemula Usia 17 Tahun (Revisi)",
    "content": "Perekaman biometrik sidik jari, iris mata, dan foto wajah untuk warga negara yang telah genap berusia 17 tahun atau sudah menikah dengan membawa fotokopi KK ke kantor kecamatan atau gerai pelayanan publik terpadu."
  }
  ```
- **Response Status**: `200 OK`
- **Response Body**:
  ```json
  {
    "data": {
      "category": "Kependudukan",
      "content": "Perekaman biometrik sidik jari, iris mata, dan foto wajah untuk warga negara yang telah genap berusia 17 tahun atau sudah menikah dengan membawa fotokopi KK ke kantor kecamatan atau gerai pelayanan publik terpadu.",
      "embedding_dimension": 768,
      "id": 1,
      "title": "Penerbitan KTP Elektronik Baru Pemula Usia 17 Tahun (Revisi)"
    },
    "message": "Dokumen dan vector embedding berhasil diperbarui",
    "status": "success"
  }
  ```

---

### 5. Delete Document (Hapus Dokumen)
- **Method**: `DELETE`
- **URL**: `http://localhost:8080/documents/101`
- **Response Status**: `200 OK`
- **Response Body**:
  ```json
  {
    "message": "Dokumen dengan ID 101 berhasil dihapus",
    "status": "success"
  }
  ```

---

### 6. Semantic Vector Search & AI Feedback Assistant (Umpan Balik AI)
Mencari dokumen terdekat di pgvector lalu **merumuskan tanggapan cerdas (AI feedback)** langsung untuk menjawab pertanyaan atau menanggapi keluhan pengguna.

AI secara otomatis:
1. Menyebutkan produk / layanan terkait (`related_service`).
2. Memberikan inisiatif respon cepat tanggap dalam deskripsi pendek (`short_description`).
3. Memberikan rangkuman deskripsi panjang solusi lengkap, berkas persyaratan, dan prosedur tahapan (`long_summary`).
4. Menyertakan skor kemiripan tertinggi (`best_similarity_percentage`) dan referensi sumber (`matched_sources`).

#### Cara A: Menggunakan POST (Rekomendasi untuk Pertanyaan / Keluhan Panjang)
- **Method**: `POST`
- **URL**: `http://localhost:8080/documents/search`
- **Headers**:
  ```http
  Content-Type: application/json
  ```
- **Body (raw JSON)**:
  ```json
  {
    "query": "KTP saya patah dan rusak fotonya, gimana cara gantinya?",
    "limit": 3
  }
  ```

#### Cara B: Menggunakan GET (Query Parameter)
- **Method**: `GET`
- **URL**: `http://localhost:8080/documents/search?q=KTP%20saya%20patah%20dan%20rusak%20fotonya,%20gimana%20cara%20gantinya?&limit=3`

- **Response Status**: `200 OK`
- **Response Body (Umpan Balik AI Nyata)**:
  ```json
  {
    "status": "success",
    "query": "KTP saya patah dan rusak fotonya, gimana cara gantinya?",
    "feedback": {
      "related_service": "Penggantian e-KTP Rusak, Buram, atau Patah",
      "category": "Kependudukan",
      "short_description": "Halo! Jangan khawatir, Anda dapat memanfaatkan layanan Penggantian e-KTP Rusak, Buram, atau Patah untuk mencetak ulang KTP Anda yang rusak tanpa perlu melakukan perekaman sidik jari ulang.",
      "long_summary": "Untuk mengganti e-KTP Anda yang patah dan fotonya memudar, Anda dapat mengajukan permohonan ke Kantor Disdukcapil atau kantor kecamatan terdekat. Dokumen pendukung yang perlu dibawa meliputi fisik e-KTP lama yang rusak dan fotokopi Kartu Keluarga (KK). Petugas akan langsung memproses pencetakan ulang blangko e-KTP baru Anda secara cepat tanpa perlu antre perekaman biometrik ulang.",
      "best_similarity": 0.7300,
      "best_similarity_percentage": "73.00%"
    },
    "matched_sources": [
      {
        "id": 2,
        "category": "Kependudukan",
        "title": "Penggantian e-KTP Rusak, Buram, atau Patah",
        "similarity": 0.7300,
        "similarity_percentage": "73.00%"
      },
      {
        "id": 3,
        "category": "Kependudukan",
        "title": "Penerbitan Surat Keterangan Pengganti KTP Hilang",
        "similarity": 0.6428,
        "similarity_percentage": "64.28%"
      }
    ]
  }
  ```

---

### 7. Reset Database (Bersihkan & Reset ID ke 1)
- **Method**: `POST`
- **URL**: `http://localhost:8080/documents/reset`
- **Response Status**: `200 OK`
- **Response Body**:
  ```json
  {
    "message": "Database berhasil dirombak bersih. Semua data lama telah dihapus dan ID direset ke 1.",
    "status": "success"
  }
  ```

---

### 8. Seed Database (Auto Isi 100 Data SOP Layanan Publik)
Membaca file `dummy_data.json` (format wrapper object `{"data": [...]}`) dan otomatis meng-embed seluruh 100 item data layanan publik ke database dengan mekanisme penanganan jeda rate-limit.

- **Method**: `POST`
- **URL**: `http://localhost:8080/documents/seed`
- **Response Status**: `201 Created`
- **Response Body**:
  ```json
  {
    "data": [
      { "category": "Kependudukan", "id": 1, "title": "Penerbitan KTP Elektronik Baru Pemula Usia 17 Tahun" },
      { "category": "Kependudukan", "id": 2, "title": "Penggantian e-KTP Rusak, Buram, atau Patah" },
      { "category": "Kependudukan", "id": 3, "title": "Penerbitan Surat Keterangan Pengganti KTP Hilang" },
      { "category": "Kependudukan", "id": 4, "title": "Pembaruan Kartu Keluarga Akibat Penambahan Anggota Baru" },
      { "category": "Sosial", "id": 11, "title": "Pendaftaran DTKS untuk Pengajuan Bantuan Sosial" },
      { "category": "Kesehatan", "id": 21, "title": "Pendaftaran Peserta BPJS Kesehatan PBI APBD Gratis" },
      { "category": "Pendidikan", "id": 31, "title": "Penerimaan Peserta Didik Baru (PPDB) Jalur Afirmasi Miskin" },
      { "category": "Ketenagakerjaan", "id": 41, "title": "Pembuatan Kartu Kuning AK-1 Pencari Kerja Disnaker" },
      { "category": "Perizinan Usaha", "id": 51, "title": "Pembuatan Nomor Induk Berusaha (NIB) Usaha Mikro OSS" },
      { "category": "Infrastruktur & Lingkungan", "id": 61, "title": "Laporan Jalan Berlubang dan Aspal Ambles di Jalan Protokol" },
      { "category": "Keamanan & Darurat", "id": 71, "title": "Pelaporan Darurat Kebakaran Rumah ke Pemadam Kebakaran (Damkar)" },
      { "category": "Pajak & Retribusi Daerah", "id": 81, "title": "Pembayaran Pajak Bumi dan Bangunan Perdesaan dan Perkotaan (PBB-P2)" },
      { "category": "Pendidikan & Sosial", "id": 100, "title": "Bantuan Kuota Internet Belajar bagi Pelajar Prasejahtera" }
    ],
    "message": "Berhasil memasukkan 100 data dummy dengan vector embedding otomatis",
    "status": "success",
    "total_inserted": 100
  }
  ```

---

## 6. Best Practice & Tips Optimasi

1. **Gunakan HNSW Index untuk Dataset Besar**:
   - `HNSW (Hierarchical Navigable Small World)` memberikan performa pencarian yang jauh lebih cepat daripada `IVFFlat` dan tidak memerlukan pelatihan awal (*training step*).
   - Penggunaan operator cosine: `vector_cosine_ops` dengan operator `<=>`.

2. **Asymmetric Task Type di Gemini**:
   - Selalu bedakan `TaskType: "RETRIEVAL_DOCUMENT"` saat menyimpan dokumen dan `TaskType: "RETRIEVAL_QUERY"` saat mencari query. Hal ini secara signifikan meningkatkan akurasi *semantic search*.

3. **Embedding Dimension (768)**:
   - Model `gemini-embedding-001` secara default menghasilkan 768 dimensi. Pastikan kolom database menggunakan tipe `VECTOR(768)` agar sesuai.

4. **Jangan Kembalikan Kolom Embedding Mentah di Endpoint Read**:
   - Mengembalikan array 768 angka float dalam JSON respon untuk setiap dokumen akan memperlambat response time dan memboroskan bandwidth. Cukup sertakan `id`, `category`, `title`, dan `content`.
