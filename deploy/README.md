# Deploy produksi

Panduan memasang claudewa di satu server Linux dengan Docker Compose, dengan
nginx dan HTTPS di depannya. Ditujukan untuk siapa pun yang mengoperasikan
server, termasuk yang tidak ikut menulis kodenya.

```
internet ──443──> nginx (host) ──┬─ /webhooks/, /api/v1/, /health ──> webhook :3001
                                 └─ selebihnya ───────────────────> web     :3002
                                                                       │
          container (jaringan internal, tidak terbuka ke luar):        │
          worker ── redis ── postgres+pgvector ── ai-knowledge :8080 ──┘
          migrate (jalan sekali tiap deploy, lalu berhenti)
```

| Berkas | Isi |
|---|---|
| `../Dockerfile` | Image Node: web, webhook, worker, migrate |
| `../apps/ai-knowledge/Dockerfile` | Image layanan Go (basis pengetahuan + router `/route`) |
| `compose.yml` | Semua layanan beserta volume dan health check |
| `.env.example` | Variabel yang harus diisi, disalin ke `deploy/.env` |
| `nginx/claudewa.conf` | Reverse proxy di host |
| `deploy.sh` | Pasang/perbarui: tarik kode, build, migrasi, restart |
| `backup.sh` | Cadangan database harian |

## 1. Kebutuhan server

- Linux (Ubuntu 22.04/24.04 atau Debian 12), minimal 2 vCPU / 4 GB RAM / 40 GB
  disk. Saran 4 vCPU / 8 GB. Build image pertama butuh ±2 GB RAM sendiri.
- Subdomain yang A record-nya mengarah ke IP publik server.
- Port 80 dan 443 terbuka dari internet (Meta mengirim webhook ke 443).
  Port lain tidak perlu dibuka.
- Akses keluar ke `graph.facebook.com`, `generativelanguage.googleapis.com`
  (Gemini), registry Docker, npm, dan GitHub.

## 2. Pemasangan pertama

### 2.1 Pasang Docker, nginx, certbot

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER        # lalu logout-login
sudo apt install -y nginx certbot python3-certbot-nginx git
```

### 2.2 Ambil kode dan isi konfigurasi

```bash
git clone <url-repo> claudewa && cd claudewa
cp deploy/.env.example deploy/.env
nano deploy/.env
chmod 600 deploy/.env
```

Isi setiap nilai sesuai komentar di file itu. Dua yang paling penting:

- `ENCRYPTION_KEY` — kalau memindahkan data dari server lama, **salin persis
  dari `.env` lama**. Simpan juga salinannya di tempat lain: kunci ini hilang
  berarti semua token nomor WA harus didaftarkan ulang.
- `POSTGRES_PASSWORD` — buat dengan `openssl rand -hex 24`.

### 2.3 (Opsional) Pindahkan data dari server lama

Lewati kalau ini install baru. Lakukan **sebelum** aplikasi pertama kali
dinyalakan, supaya migrasi berjalan di atas data lama.

```bash
# Di mesin yang bisa menjangkau database lama:
pg_dump -Fc --no-owner --no-acl "postgresql://USER:PASS@HOST:5432/DB" > lama.dump

# Di server baru:
docker compose -f deploy/compose.yml up -d postgres
docker compose -f deploy/compose.yml exec -T postgres \
  pg_restore -U wa -d wa_platform --no-owner --no-acl < lama.dump
```

Kalau database lama dipakai bersama aplikasi lain, tabel milik aplikasi itu
ikut terbawa. Tidak merusak, tapi bisa dihapus setelahnya.

### 2.4 Build dan nyalakan

```bash
chmod +x deploy/*.sh
./deploy/deploy.sh --no-pull
```

Build pertama makan 5–10 menit. Setelah selesai, `docker compose -f
deploy/compose.yml ps` harus menunjukkan `migrate` berstatus *exited (0)* dan
layanan lain *running/healthy*.

### 2.5 Buat akun dashboard pertama

```bash
docker compose -f deploy/compose.yml run --rm web \
  node --import tsx src/scripts/user-add.ts \
  --email admin@contoh.go.id --name "Admin" --password "minimal-8-karakter"
```

Lewati kalau data lama sudah dipindahkan (akunnya ikut terbawa).

### 2.6 nginx dan HTTPS

```bash
sudo cp deploy/nginx/claudewa.conf /etc/nginx/sites-available/claudewa
sudo sed -i 's/wa.contoh.go.id/DOMAIN-ANDA/' /etc/nginx/sites-available/claudewa
sudo ln -s /etc/nginx/sites-available/claudewa /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d DOMAIN-ANDA
```

Buka `https://DOMAIN-ANDA` dan login.

### 2.7 Sambungkan ke Meta

1. Di dashboard, halaman **Nomor**: salin *Callback URL* tiap koneksi WABA
   (bentuknya `https://DOMAIN/webhooks/whatsapp/<id>`) dan *Verify token*-nya.
2. Di Meta App → WhatsApp → Configuration, ganti Callback URL lama (misalnya
   URL cloudflared) dengan yang baru, lalu *Verify and save*.
3. Kirim pesan uji ke nomornya dan pastikan muncul di Inbox.

### 2.8 Arahkan AI ke layanan internal

URL AI yang tersimpan dari server lama masih menunjuk `localhost`. Di halaman
**AI**, ubah:

| Jenis | URL baru |
|---|---|
| Arahkan ke menu (router) | `http://ai-knowledge:8080/route` |
| Jawab pertanyaan (pencarian SOP) | `http://ai-knowledge:8080/documents/search` (sesuaikan path/query yang dipakai) |

Header `X-Internal-API-Key` di endpoint itu harus sama dengan
`AI_KNOWLEDGE_API_KEY` di `deploy/.env`. Pakai tombol uji di halaman itu.
`http://` ke `ai-knowledge:8080` diizinkan karena compose mengisi
`INTERNAL_SERVICE_HOSTS`; alamat internal lain tetap ditolak.

### 2.9 Jadwalkan cadangan

```bash
crontab -e
# tambahkan:
30 1 * * * /home/USER/claudewa/deploy/backup.sh >> /home/USER/claudewa-backup.log 2>&1
```

Sesekali salin isi `deploy/backups/` ke luar server.

## 3. Operasional harian

| Keperluan | Perintah (dari folder repo) |
|---|---|
| Status layanan | `docker compose -f deploy/compose.yml ps` |
| Log semua / satu layanan | `docker compose -f deploy/compose.yml logs -f --tail=100 worker` |
| Restart satu layanan | `docker compose -f deploy/compose.yml restart worker` |
| Perbarui ke kode terbaru | `./deploy/deploy.sh` |
| Matikan semua | `docker compose -f deploy/compose.yml down` (data tetap ada di volume) |
| Masuk ke database | `docker compose -f deploy/compose.yml exec postgres psql -U wa wa_platform` |

**Rollback**: `git checkout <commit-sebelumnya>` lalu
`./deploy/deploy.sh --no-pull`. Migrasi database tidak ikut mundur, jadi
pulihkan cadangan dulu kalau versi baru mengubah skema. Kembali ke versi
terbaru: `git checkout main && ./deploy/deploy.sh`.

**Jangan** menjalankan `down -v`: itu menghapus volume database dan Redis.

## 4. Kalau ada masalah

| Gejala | Periksa |
|---|---|
| `migrate` gagal, layanan lain tidak naik | `logs migrate`. Biasanya `POSTGRES_PASSWORD` berubah setelah volume dibuat; password lama tetap berlaku di volume itu. |
| Pesan warga tidak masuk | Callback URL di Meta, `logs webhook`, dan `curl https://DOMAIN/health`. |
| Pesan masuk tapi bot diam | `logs worker`. Flow aktif dan terbit? |
| Arahkan AI selalu jatuh ke menu | URL di halaman AI (§2.8), `logs ai-knowledge`, `GEMINI_API_KEY`. |
| Login berputar kembali ke halaman login | `DOMAIN` di `deploy/.env` harus sama persis dengan alamat yang dibuka. |
| Token nomor WA "tidak bisa didekripsi" | `ENCRYPTION_KEY` berbeda dari yang dipakai saat nomor didaftarkan. |
