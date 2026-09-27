# Backlog

Hal yang sudah diketahui kurang, tapi **belum dikerjakan**. Jangan mulai tanpa
diminta.

---

## Media butuh hosting publik

**Masalah.** Node "Kirim media" sekarang hanya menerima URL `https` publik atau
media ID dari Meta. Keduanya bermasalah untuk pemakaian sekarang:

- Meta sendiri yang mengunduh file dari URL, jadi `localhost` dan MinIO lokal
  tidak akan pernah bisa dipakai.
- Media ID terikat pada satu phone number yang mengunggahnya, jadi rusak begitu
  flow yang sama jalan di channel kedua.

Akibatnya node media praktis tidak terpakai sampai gambar di-host di tempat
lain (Cloudinary, R2, S3, dll).

**Arah yang sudah dipertimbangkan.** MinIO sudah berjalan sejak awal dengan
bucket `wa-media` tapi belum terpakai sama sekali, dan service webhook sudah
terekspos publik lewat tunnel. Menyajikan file kita sendiri dari host webhook
menghindari hosting eksternal maupun keterikatan media ID pada satu nomor.

Perkiraan cakupannya: model `MediaAsset`, klien S3 di `@wa/core`, server action
unggah, rute `GET /media/:id` di service webhook, dan pemilih berkas di
inspector. Butuh dependensi baru (`@aws-sdk/client-s3`) dan migrasi.

**Sebagian teratasi (23 Sep 2026).** Public API punya `POST /media` yang
mengunggah ke Meta dan mengembalikan media ID, jadi sistem lain tidak lagi butuh
hosting publik. Node "Kirim media" di flow builder belum memakainya, dan media ID
tetap terikat pada satu nomor.

---

## Pesan setelah node media bisa sampai duluan

**Masalah.** Node media diikuti node lain bisa tiba terbalik di HP penerima.
Terbukti pada percakapan `cmuap7i970009poymnnvnqb8o`, 21 September 2026:

| pesan | ack diterima | Meta benar-benar kirim |
|---|---|---|
| image | 12:11:09.253 | 12:11:13 |
| list  | 12:11:10.052 | 12:11:10 |

Gerbang urutan di `enqueueSend` bekerja benar — list menunggu giliran, hanya
0,8 detik setelah image. Penyebabnya di sisi Meta: untuk media lewat URL, Meta
membalas `200` lebih dulu lalu mengunduh berkasnya sendiri (~4 detik) sebelum
mengirim. List yang menyusul tidak perlu mengunduh apa pun, jadi menyalip.

Dashboard tampak benar karena mengurutkan berdasarkan `createdAt` (waktu ack);
HP mengurutkan berdasarkan waktu Meta mengirim. Bukan soal jaringan HP, dan
akan terulang tiap kali node media diikuti node lain — makin besar gambarnya,
makin besar selisihnya.

**Arah yang sudah dipertimbangkan.** Giliran dilepas tepat setelah
`provider.send()` balik (`outbound.ts`), yaitu saat Meta *menerima*, bukan saat
Meta *mengirim*. Tiga pilihan, belum diputuskan:

1. Tahan giliran sampai status `sent` tiba dari webhook, bukan sampai API
   membalas. Paling benar. Butuh penjaga waktu (mis. lepas paksa setelah 15
   detik) supaya percakapan tidak macet kalau status tidak pernah datang, dan
   sebaiknya dibatasi untuk pesan media saja agar teks tetap secepat sekarang.
2. Unggah ke Meta sekali lalu pakai media ID — menghapus unduhan saat kirim,
   jadi menutup akarnya. Terikat pada pekerjaan hosting media di atas.
3. Sisipkan node Jeda beberapa detik setelah node media. Tanpa ubah kode, tapi
   tebakan: gambar besar tetap bisa menyalip.

---

## Lainnya yang tercatat

- **`META_GRAPH_VERSION` masih hanya dari `.env`.** Halaman pengaturan
  menampilkannya read-only. Memindahkannya ke database butuh `credentialsFor`
  jadi async, dan itu merembet ke semua pemanggilnya.
- **`PUBLIC_WEBHOOK_ORIGIN` belum diisi.** Selama kosong, callback URL tiap
  koneksi tampil sebagai `https://<tunnel-kamu>/...` dan harus dilengkapi
  manual sebelum dipaste ke Meta.
- **Node "Kirim template" belum bisa mengisi parameter tombol.** URL dinamis
  dan kode kupon hanya bisa diisi dari inbox; inspector memberi peringatan.
- **Kirim template dari inbox belum pernah diuji dengan template berparameter.**
  Dua template yang ada saat sinkron pertama (`aaa`, `hello_world`) tidak punya
  isian, jadi jalur parameter bernama, header media, dan tombol baru terbukti
  lewat test unit.

  Kandidat yang sudah disepakati untuk diajukan (belum diajukan, menunggu
  keputusan): `wa_mantap_sapaan` — UTILITY (Meta bisa mengubahnya ke
  MARKETING), bahasa `id`, body = Template 1 dari `wa-mantap-templates.json`
  dengan `*Ahmad*` diganti `*{{nama}}*` (contoh `Budi`), plus satu tombol
  quick reply `Menu`. Sisa 155 teks di berkas itu adalah balasan sesi dalam
  window 24 jam, bukan template — jangan diajukan (satu di antaranya juga
  melebihi batas body 1024 karakter). Setelah disetujui: sinkronkan, lalu uji
  kirim dari inbox ke nomor sendiri.
- **Public API & webhook keluar belum diuji dengan pengiriman sungguhan.**
  Diuji 23 Sep 2026 tanpa mengirim WhatsApp: autentikasi, validasi, kontak,
  riwayat pesan, `window_closed`, ping + retry + tanda tangan ke penerima
  lokal. Belum terbukti: `POST /messages` yang benar-benar terkirim, event
  `message.sent/delivered/read` dari pesan nyata, dan
  `POST /flows/:id/trigger` sampai flow jalan. Halaman Pengaturan bagian
  Webhook keluar juga belum dilihat di browser (butuh login).

  Ditambahkan 23 Sep 2026, juga baru diuji tanpa kirim: jenis pesan `buttons`,
  `list`, `ctaUrl`, `location`, `sticker`, `flow`; `GET /templates`,
  `GET /flows`, `POST /media` (hanya jalur penolakan; unggahan sungguhan ke Meta
  belum); API key yang dibatasi per nomor; rate limit di Redis. Balasan formulir
  (`form_reply`) baru terbukti lewat test unit normalizer.
- **Broadcast belum pernah mengirim sungguhan.** Runner diuji 23 Sep 2026
  dengan antrean tiruan: pembuatan daftar penerima, penerima STOP dilewati,
  lease mencegah rantai tick ganda, hitungan akhir, dan jeda. Belum terbukti
  sampai Meta. Selama WABA berstatus BLOCKED (141006, metode pembayaran),
  template ke kontak di luar window akan ditolak Meta; hasilnya tercatat sebagai
  penerima gagal, bukan error diam.
- **Halaman dashboard baru belum dilihat di browser (butuh login).** Kontak,
  Broadcast (daftar, form, detail), pilihan nomor di form API key, dan tampilan
  media di inbox baru terbukti lewat `next build` dan typecheck. Rute
  `/api/media/[messageId]` belum pernah mengambil berkas sungguhan dari Meta.
- **Channel lama masih memakai callback lama.** Nomor CS Utama terdaftar
  sebelum model koneksi per-WABA ada, jadi masih lewat `/webhooks/whatsapp`
  dengan secret tingkat organisasi.
- **Pesan penutup auto-resume belum pernah diuji betulan.** Sweeper
  mengembalikan bot 2 jam setelah agen diam dan mengirim teks penutup, tapi
  jalur kirimnya belum dibuktikan — mengujinya berarti mengirim WhatsApp
  sungguhan ke nomor kontak.
- **Node "Tunggu balasan" dan "Kondisi" belum pernah jalan di lingkungan
  nyata.** Keduanya sudah punya test unit, tapi belum pernah dilalui pesan
  WhatsApp sungguhan.

---

## Sudah diputuskan — jangan dibongkar

Bukan pekerjaan terbuka. Dicatat supaya tidak dikerjakan ulang atau
diselidiki ulang.

- **Dashboard tidak menyentuh antrean broadcast.** Tombol Mulai/Jeda hanya
  mengubah status campaign; worker menemukannya lewat polling tiap 5 detik
  (`armDueCampaigns`). Sama dengan outbox webhook keluar, dan menjaga bullmq
  tetap di luar bundle dashboard.
- **Broadcast selalu melewati kontak OPTED_OUT, apa pun kategori templatenya.**
  Beda dari `POST /messages`, yang hanya menolak template MARKETING: kiriman
  massal yang tidak diminta adalah persis yang dihentikan orang dengan STOP.

- **Queue tidak boleh kembali ke barrel `@wa/core`.** Impor lewat
  `@wa/core/queues`. Queue membuka socket Redis begitu disentuh; selama masih
  di barrel, dashboard ikut menyeret bullmq dan ioredis dan build web
  mengeluarkan lima peringatan (juga penyebab CLI script dulu menggantung).
  Pemakainya hanya webhook dan worker — lima berkas. Kalau ada peringatan
  "Critical dependency" muncul lagi, cek dulu apakah ada yang menambahkannya
  kembali ke `packages/core/src/index.ts`. Lihat `33c944b`.
- **Latensi ~4 detik di mode dev bukan masalah.** Itu kompilasi on-demand Next
  saat dev; di build produksi latensinya 10–80 ms.
