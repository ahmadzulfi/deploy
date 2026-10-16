# wa-platform

Platform WhatsApp internal: multi-nomor WABA, shared inbox, flow builder drag-and-drop, broadcast.

Fondasi, round-trip pesan, dashboard, flow builder, broadcast, dan Public API sudah ada. Sisa yang besar: uji nyata fitur yang belum pernah mengirim sungguhan (lihat `BACKLOG.md`).

---

## Yang sudah ada

```
packages/db      Prisma schema — seluruh model (channel, contact, conversation,
                 message, template, flow, campaign, audit)
packages/core    ChannelProvider abstraction, CloudApiProvider, webhook
                 normalizer, WhatsApp limits, crypto, queues
apps/webhook     Fastify receiver — verifikasi signature, simpan raw, enqueue,
                 plus Public API /api/v1
apps/worker      Inbound processor, outbound sender (queue per channel), flow
                 engine, campaign runner, sweeper sesi, pengirim webhook
                 keluar, CLI
apps/web         Dashboard Next.js — inbox, nomor, kontak, template,
                 broadcast, flow builder, AI, basis pengetahuan, pengaturan
apps/docs        Referensi Public API (Fumadocs) — `pnpm dev:docs`, buka :5000
apps/ai-knowledge  Layanan Go: dokumen SOP + pencarian semantik (pgvector,
                 Gemini) di balik node Tanya AI — `pnpm dev:ai`, butuh Go
```

Deploy produksi (Docker Compose + nginx + HTTPS): lihat `deploy/README.md`.

Yang belum: uji nyata broadcast, Public API, dan webhook keluar. Rinciannya di
`BACKLOG.md`.

Referensi Public API — endpoint, contoh kode, dan playground — ada di `apps/docs`,
di-generate dari `apps/docs/openapi.yaml`. Buka http://localhost:5000.

---

## Setup

### 1. Infra

```bash
docker compose up -d
```

Postgres :5435, Redis :6381, MinIO :9000 (console :9001, login `wa_minio` / `wa_minio_dev_password`). Semua di-bind ke `127.0.0.1` saja.

Port-nya sengaja bukan default: mesin ini sudah menjalankan stack lain (chatwoot di 5433/6379, wa_bridge di 5434/6380) dan 6379 akan bentrok.

> Image MinIO ditarik dari Docker Hub — compose ini memakai `quay.io/minio/*`, registry resmi mereka, dengan tag di-pin. Rilis community terakhir di sana bertanggal September 2025, jadi jangan heran kalau `latest` tidak bergerak. Untuk produksi, S3/R2/Spaces lebih aman daripada bergantung pada MinIO community.

### 2. Env

```bash
cp .env.example .env
```

Generate `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Isi juga `META_APP_SECRET` (App Dashboard → Settings → Basic) dan `WEBHOOK_VERIFY_TOKEN` (bebas, string apa saja — nanti dipaste ke Meta).

Yang **tidak** masuk `.env`: access token, phone number ID, dan WABA ID. Ketiganya milik masing-masing nomor, bukan milik aplikasi, jadi tempatnya di database lewat `pnpm channel:add` (langkah 5). Itulah yang membuat satu instance bisa memegang banyak nomor sekaligus.

| Punya kamu | Tujuan |
|---|---|
| `WA_APP_SECRET` | `.env` → `META_APP_SECRET` |
| `WA_API_VERSION` | `.env` → `META_GRAPH_VERSION` |
| `WA_ACCESS_TOKEN` | `channel:add --token` (DB, terenkripsi) |
| `WA_PHONE_NUMBER_ID` | `channel:add --phone-id` |
| `WA_BUSINESS_ACCOUNT_ID` | `channel:add --waba` |

> Jangan menaruh nilai asli di `.env.example` — file itu ikut ter-commit. Hanya `.env` yang di-gitignore.

> `ENCRYPTION_KEY` mengenkripsi seluruh token channel. Kehilangan key ini = semua channel harus didaftar ulang. Backup terpisah dari repo.

### 3. Install & migrate

Butuh pnpm (`npm i -g pnpm`) dan Node 22+.

```bash
pnpm install
```

```bash
pnpm db:migrate --name init
```

Beri `--name`, kalau tidak Prisma akan meminta nama migrasi secara interaktif. Hasilnya 17 tabel + 14 enum.

Butuh pnpm tapi tidak mau install global? `corepack prepare pnpm@9.12.0 --activate` sudah cukup.

### 4. Expose webhook

```bash
pnpm dev:webhook
```

Di terminal lain, buka tunnel HTTPS. Pakai **cloudflared** — tanpa akun, tanpa authtoken:

```bash
cloudflared tunnel --url http://localhost:3001
```

Ambil URL `https://<acak>.trycloudflare.com` dari outputnya.

<details>
<summary>Kenapa bukan ngrok?</summary>

Bisa saja, tapi di mesin ini ngrok bermasalah berlapis: versi Laragon (3.1.0) ditolak server karena akun mensyaratkan minimum 3.20.0, dan setelah `ngrok update` berhasil, Windows Defender memblokir binary barunya sebagai *potentially unwanted software* — false positive yang lazim untuk tool tunneling.

Kalau tetap mau ngrok: izinkan `C:\laragon\bin\ngrok\ngrok.exe` di Windows Security, atau install ulang lewat `winget install ngrok.ngrok`. Config-nya sudah diturunkan ke `version: "2"` (backup di `ngrok.yml.bak`); agent baru tetap menerima format itu.
</details>

Lalu di Meta App Dashboard → WhatsApp → Configuration → Webhook:

- Callback URL: `https://<acak>.trycloudflare.com/webhooks/whatsapp`
- Verify token: nilai `WEBHOOK_VERIFY_TOKEN` dari `.env`
- Subscribe ke field: **messages**

> URL tunnel gratis berubah setiap kali dijalankan ulang — begitu restart, callback URL di Meta harus diperbarui juga.

Kalau handshake sukses, log webhook menulis `webhook verification handshake succeeded`.

### 5. Daftarkan nomor

```bash
pnpm channel:add --name "CS Utama" --waba <WABA_ID> --phone-id <PHONE_NUMBER_ID> --token <SYSTEM_USER_TOKEN>
```

Pakai **System User token**, bukan token sementara dari Graph API Explorer — yang itu expire 24 jam dan besoknya semua pengiriman gagal tanpa pesan error yang menyebut expiry. Buat di Business Settings → System Users → Generate Token, pilih asset WABA, scope `whatsapp_business_messaging` + `whatsapp_business_management`.

Script ini memverifikasi kredensial ke Graph API dan auto-subscribe app ke WABA sebelum menyimpan. Ulangi untuk tiap nomor.

```bash
pnpm channel:list
```

### 6. Round-trip test

```bash
pnpm dev:worker
```

```bash
pnpm send:test --channel <channelId> --to <nomor HP kamu, contoh 6285111213481> --buttons
```

Nomor dalam format E.164 tanpa `+` dan tanpa spasi.

⚠️ **Kirim pesan apa pun dari HP itu ke nomor bisnismu dulu.** Tombol dan teks biasa adalah pesan free-form, hanya boleh dikirim dalam 24 jam setelah kontak menghubungi lebih dulu. Kalau belum, Meta menolak dengan `131047` dan satu-satunya jalan adalah template yang sudah disetujui.

Balas dari WhatsApp. Log worker harus menulis `inbound message stored`.

**Milestone fase 1 tercapai kalau ini jalan di dua nomor berbeda secara bersamaan** — itu membuktikan routing multi-WABA lewat `phone_number_id` sudah benar, dan sisanya tinggal fitur di atas fondasi yang sama.

---

## Smoke test tanpa WhatsApp

Jalankan `pnpm dev:webhook` dan `pnpm dev:worker`, lalu kirim webhook bertanda tangan ke receiver lokal — tanpa ngrok, tanpa Meta, tanpa memakai kuota percakapan:

```bash
pnpm webhook:fake -- --phone-id <PHONE_NUMBER_ID> --from 628123456789 --text "menu"
```

```bash
pnpm webhook:fake -- --phone-id <PHONE_NUMBER_ID> --from 628123456789 --button btn_yes
```

```bash
pnpm webhook:fake -- --phone-id <PHONE_NUMBER_ID> --status delivered --wamid wamid.XXX
```

Worker harus menulis `inbound message stored`. Kirim wamid yang sama dua kali untuk membuktikan dedupe, dan kirim `--text STOP` untuk membuktikan opt-out.

---

## Basis pengetahuan

Halaman **Basis Pengetahuan** (`/knowledge`) di dashboard mengelola dokumen SOP di layanan `apps/ai-knowledge` (Go + pgvector + Gemini) — sumber jawaban node Tanya AI. Dashboard memanggilnya lewat HTTP; isi di `.env` root:

```bash
AI_KNOWLEDGE_URL="https://<layanan ai-knowledge>"
AI_KNOWLEDGE_API_KEY="<INTERNAL_API_KEY layanan itu>"
```

Menjalankan layanannya sendiri butuh Go (`winget install GoLang.Go`). Layanan ini membaca `.env` di foldernya sendiri, bukan `.env` root — salin `apps/ai-knowledge/.env.example` ke `apps/ai-knowledge/.env`, isi, lalu:

```bash
pnpm dev:ai
```

Isi `ADMIN_SECRET_KEY` di sana. Tanpa itu, `POST /documents/reset` (menghapus seluruh dokumen) terbuka bagi siapa pun yang memegang `INTERNAL_API_KEY`.

Untuk mencoba tanpa menyentuh dokumen sungguhan maupun kuota Gemini, pakai tiruannya lalu isi `AI_KNOWLEDGE_URL="http://localhost:4020"`:

```bash
pnpm knowledge:fake
```

Admin bisa menambah, mengubah, dan menghapus dokumen; agen ke atas bisa menguji pertanyaan. Setiap perubahan dicatat lengkap dengan isinya di audit log, karena layanannya sendiri tidak menyimpan riwayat. Referensi API-nya ada di docs: **Layanan internal → Layanan pengetahuan**.

> Layanan ini memakai database yang sama dengan platform. Ke database itu jalankan `pnpm --filter @wa/db deploy`, **bukan** `pnpm db:migrate`: `prisma migrate dev` menganggap tabel layanan pengetahuan sebagai drift dan menawarkan reset skema.

---

## Test

Validator limit WhatsApp dan normalizer webhook murni logika, jadi bisa dites tanpa infra apa pun:

```bash
node --experimental-strip-types --test packages/core/test/*.test.ts
```

20 test, tidak butuh Postgres/Redis/Meta. Jalankan ini dulu sebelum menyalahkan Meta kalau ada payload yang tidak terbaca.

Seluruh source sengaja bebas dari sintaks TS yang tidak bisa dihapus begitu saja (`erasableSyntaxOnly` di `tsconfig.base.json`), supaya Node bisa menjalankannya langsung tanpa build step.

---

## Catatan desain

**Kenapa webhook dipisah dari worker.** Meta retry kalau endpoint lambat dan akhirnya menonaktifkan subscription. Receiver hanya verifikasi signature → simpan raw → enqueue → 200. Semua interpretasi payload terjadi di worker, di mana kegagalan bisa di-retry tanpa membuat Meta marah.

**Kenapa satu queue per channel.** Blast 50k di satu nomor tidak boleh menahan balasan live di nomor lain. Queue terpisah + rate limiter per channel (`throughputPerSec`) menjamin itu; satu queue bersama akan tetap menyerialkan keduanya berapa pun prioritas job-nya.

**Kenapa `WA_LIMITS` ada di satu file.** Flow builder membacanya untuk men-disable tombol ke-4, provider membacanya untuk menolak payload sebelum memanggil API. Dua titik penegakan, satu sumber kebenaran.

**Kenapa `FlowSession` menunjuk ke `FlowVersion`, bukan `Flow`.** Publish flow baru saat ada ratusan orang di tengah percakapan tidak boleh membuat mereka nyangkut di node yang sudah dihapus.

**Dedupe.** `Message.waMessageId` unique. Meta bisa mengirim payload yang sama dua kali; unique violation di inbound processor ditangani sebagai "sudah pernah" dan bukan error.

---

## Urutan berikutnya

1. `apps/web` — Next.js, auth, halaman Channels (baca model yang sudah ada)
2. Inbox + realtime
3. Template sync (`provider.listTemplates()` sudah siap, tinggal dipanggil terjadwal)
4. Flow builder + engine
