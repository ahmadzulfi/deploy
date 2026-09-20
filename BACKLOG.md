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

---

## Lainnya yang tercatat

- **`META_GRAPH_VERSION` masih hanya dari `.env`.** Halaman pengaturan
  menampilkannya read-only. Memindahkannya ke database butuh `credentialsFor`
  jadi async, dan itu merembet ke semua pemanggilnya.
- **`PUBLIC_WEBHOOK_ORIGIN` belum diisi.** Selama kosong, callback URL tiap
  koneksi tampil sebagai `https://<tunnel-kamu>/...` dan harus dilengkapi
  manual sebelum dipaste ke Meta.
- **Sinkronisasi template dari Meta belum ada.** `provider.listTemplates()`
  sudah siap tapi belum dipanggil dari mana pun, jadi node "Kirim template"
  masih meminta nama template diketik manual tanpa validasi.
- **Halaman Kontak dan Broadcast belum ada.** Keduanya masih ditandai
  "belum tersedia" di rail navigasi.
- **Channel lama masih memakai callback lama.** Nomor CS Utama terdaftar
  sebelum model koneksi per-WABA ada, jadi masih lewat `/webhooks/whatsapp`
  dengan secret tingkat organisasi.
- **Node "Tunggu balasan" dan "Kondisi" belum pernah jalan di lingkungan
  nyata.** Keduanya sudah punya test unit, tapi belum pernah dilalui pesan
  WhatsApp sungguhan.
