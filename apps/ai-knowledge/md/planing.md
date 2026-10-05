# 📋 Perencanaan Integrasi AI Knowledge Service (`planing.md`)

> **Penempatan di Repo 1:** `apps/docs/content/docs/ai-knowledge/planing.md`

---

## 🎯 1. Tujuan Utama & Perubahan Arsitektur

1. **Hapus Webhook WhatsApp di Aplikasi Go**:
   - Go **bukan lagi penerima webhook WA**. Endpoint `/webhook/wa` dihapus.
   - Urusan WhatsApp (pesan masuk, sesi chat, kontak, kirim balasan) **100% dikelola oleh Aplikasi Utama (Repo 1)**.
2. **Aplikasi Go Menjadi Internal AI API**:
   - Go murni bertindak sebagai **Knowledge Engine via REST API**.
   - Repo 1 memanggil API Go hanya saat butuh pencarian semantik SOP / jawaban AI.
3. **Menggunakan 1 Database Bersama (Shared PostgreSQL)**:
   - Repo 1 dan Repo Go terhubung ke **database PostgreSQL yang sama** (sudah aktif `pgvector`).
   - **Repo 1** mengelola tabel chat & bisnis (`Message`, `Conversation`, `Contact`, `Flow`, dll).
   - **Repo Go** mengelola tabel pengetahuan AI (`documents`, `document_chunks`, `query_cache`).
   - Tidak perlu dua database terpisah dan tidak butuh sinkronisasi data yang rumit.

---

## 🔄 2. Alur Kerja Sederhana

```mermaid
flowchart LR
    User[Pengguna WA] <--> Repo1[Aplikasi Utama\nRepo 1]
    Repo1 <-->|POST /documents/search\n(REST API)| GoAI[AI Service Go\nRepo 2]
    Repo1 <--> DB[(1 Shared PostgreSQL\n+ pgvector)]
    GoAI <--> DB
    GoAI <--> Gemini[Google Gemini API]
```

1. **Pesan Masuk**: Pengguna kirim chat ke WhatsApp -> Diterima webhook **Repo 1**.
2. **Panggil AI**: Repo 1 menembak REST API Go (`POST /documents/search`) mengirim pertanyaan user.
3. **Proses Knowledge**: Aplikasi Go mencari dokumen relevan di database bersama via vector cosine (`pgvector`) & Gemini AI.
4. **Respon JSON**: Go mengembalikan teks jawaban dan referensi SOP ke Repo 1.
5. **Kirim Balasan**: Repo 1 menyusun format pesan WhatsApp dan mengirimkannya kembali ke pengguna.

---

## 🔌 3. Kontrak API Utama (Repo 1 ➡️ Go)

### Endpoint: `POST /documents/search`
* **Headers**: `Content-Type: application/json`, `X-API-Key: <SECRET_KEY>`
* **Request**:
```json
{
  "query": "KTP hilang syaratnya apa saja?",
  "limit": 3
}
```

* **Response**:
```json
{
  "status": "success",
  "feedback": {
    "related_service": "Pengurusan KTP Hilang",
    "category": "Kependudukan",
    "short_description": "Untuk KTP hilang, siapkan surat kehilangan dari Polsek dan fotokopi KK.",
    "long_summary": "1. Buat surat kehilangan di Polsek.\n2. Bawa KK ke Disdukcapil/Kelurahan.\n3. Cetak ulang KTP tanpa biaya."
  },
  "results": [...]
}
```

---

## 📋 4. Checklist Eksekusi Penting

### Di Repo Go (`AI-WAMantap`):
- [ ] Hapus file `controller/wa_webhook.go`.
- [ ] Hapus rute `/webhook/wa` dan `/webhook` di `document_controller.go` & `main.go`.
- [ ] Pasang proteksi `X-API-Key` middleware pada endpoint `/documents/*`.
- [ ] Nonaktifkan/kunci endpoint berbahaya `POST /documents/reset`.

### Di Repo 1 (Aplikasi Utama):
- [ ] Pasang `AI_SERVICE_URL` dan `AI_SERVICE_API_KEY` di file `.env`.
- [ ] Buat helper / service caller untuk menembak endpoint `POST /documents/search`.
- [ ] Integrasikan hasil jawaban AI ke dalam handler pesan WhatsApp di Repo 1.
- [ ] Gunakan URL koneksi database yang sama dengan Repo Go.
