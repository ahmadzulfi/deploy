import { prisma, Prisma } from '@wa/db'
import { loadEnvFile, validateFlow, type FlowGraph, type FlowNode } from '@wa/core'

/**
 * Fills a flow with the Cimahi city-services menu.
 *
 * Written as a script rather than clicked into the editor because the graph is
 * ~40 nodes across 8 branches; laying that out by hand is where mistakes hide.
 * It writes the draft only - publishing stays a human decision.
 */

loadEnvFile()

const FLOW_ID = process.argv[2]
if (!FLOW_ID) {
  console.error('Usage: tsx src/scripts/seed-cimahi.ts <flowId>')
  process.exit(1)
}

const nodes: FlowNode[] = []
const edges: FlowGraph['edges'] = []

function add(id: string, data: FlowNode['data'], x: number, y: number) {
  nodes.push({ id, type: data.kind, position: { x, y }, data })
  return id
}

function link(source: string, target: string, sourceHandle: string | null = null) {
  edges.push({ id: `e_${source}_${sourceHandle ?? 'out'}`, source, target, sourceHandle })
}

// ---------------------------------------------------------------- spine

add(
  'trigger',
  {
    kind: 'trigger',
    match: 'keyword',
    values: ['halo', 'hai', 'menu', 'sampurasun', 'assalamualaikum', 'mulai'],
    caseSensitive: false,
  },
  600,
  0,
)

add(
  'salam',
  {
    kind: 'sendText',
    body: [
      '*Sampurasun Wargi Cimahi!* 👋',
      '',
      'Selamat datang di *WA Mantap* — layanan publik resmi Pemerintah Kota Cimahi.',
      '_Masyarakat Nyaman Tanpa Ribet._',
      '',
      'Satu nomor untuk berbagai layanan, aktif *24 jam*. Yang bisa dibantu di sini:',
      '',
      '1️⃣ *Kedaruratan* — akses cepat saat kondisi mendesak',
      '2️⃣ *Pengaduan* — sampaikan keluhan dan aspirasi',
      '3️⃣ *Informasi Kota Cimahi* — berita, kebijakan, agenda',
      '4️⃣ *Layanan Publik* — kependudukan, kelurahan, antrean MPP',
      '5️⃣ *Pariwisata* — destinasi dan agenda wisata',
      '6️⃣ *CCTV Online* — pantau titik strategis kota',
      '7️⃣ *Kejaksaan Negeri Cimahi* — e-Tilang, Rumah RJ, BAROS',
      '8️⃣ *Makan Bergizi Gratis* — SPPG, penerima manfaat, mitra',
      '',
      'Semua tanpa aplikasi tambahan dan tanpa datang ke kantor. 🙌',
    ].join('\n'),
  },
  600,
  160,
)

add(
  'menu',
  {
    kind: 'sendList',
    header: 'Menu Utama',
    body: 'Silakan pilih layanan yang Wargi butuhkan:',
    footer: 'WA Mantap · Pemerintah Kota Cimahi',
    buttonText: 'Pilih Menu',
    sections: [
      {
        title: 'Mendesak',
        rows: [
          { id: 'darurat', title: 'Kedaruratan', description: 'Nomor darurat dan bantuan cepat' },
          { id: 'pengaduan', title: 'Pengaduan', description: 'Sampaikan keluhan atau aspirasi' },
        ],
      },
      {
        title: 'Informasi',
        rows: [
          { id: 'info_kota', title: 'Informasi Kota', description: 'Berita, kebijakan, dan agenda' },
          { id: 'wisata', title: 'Pariwisata', description: 'Destinasi dan agenda wisata' },
          { id: 'cctv', title: 'CCTV Online', description: 'Pantau titik strategis kota' },
        ],
      },
      {
        title: 'Layanan',
        rows: [
          { id: 'layanan', title: 'Layanan Publik', description: 'Kependudukan, kelurahan, MPP' },
          { id: 'kejaksaan', title: 'Kejaksaan Negeri', description: 'e-Tilang, Rumah RJ, BAROS' },
          { id: 'mbg', title: 'Makan Bergizi Gratis', description: 'SPPG, penerima manfaat, mitra' },
        ],
      },
    ],
  },
  600,
  340,
)

link('trigger', 'salam')
link('salam', 'menu')

// ---------------------------------------------------------------- branches

const COL = 340
const ROW_Y = 620

/** A leaf branch: one informational message, then back to the menu offer. */
function leaf(handle: string, id: string, body: string, column: number) {
  add(id, { kind: 'sendText', body }, column * COL, ROW_Y)
  link('menu', id, handle)
  link(id, 'lagi')
}

leaf(
  'darurat',
  'b_darurat',
  [
    '🚨 *Kedaruratan*',
    '',
    'Untuk kondisi mendesak, hubungi nomor darurat berikut — semuanya bebas pulsa:',
    '',
    '• *112* — panggilan darurat nasional, terhubung ke layanan terdekat',
    '• *110* — Kepolisian',
    '• *113* — Pemadam Kebakaran',
    '• *119* — Layanan gawat darurat medis',
    '',
    'Laporan darurat lewat WhatsApp bisa tertunda. Kalau nyawa atau keselamatan sedang terancam, *telepon langsung*, jangan mengetik.',
    '',
    'Titik-titik strategis kota dipantau dari Cimahi Command Center selama 24 jam.',
  ].join('\n'),
  0,
)

leaf(
  'info_kota',
  'b_info',
  [
    'ℹ️ *Informasi Kota Cimahi*',
    '',
    'Berita, kebijakan, dan agenda kegiatan Pemerintah Kota Cimahi:',
    '',
    '• Situs resmi: cimahikota.go.id',
    '• Data terbuka: Open Data Cimahi',
    '• Informasi publik: SIMPONI',
    '',
    'Punya pertanyaan yang lebih spesifik? Pilih *Pengaduan* dari menu, nanti diteruskan ke perangkat daerah yang menangani.',
  ].join('\n'),
  1,
)

leaf(
  'wisata',
  'b_wisata',
  [
    '🏞️ *Pariwisata Kota Cimahi*',
    '',
    'Salah satu yang paling dikenal adalah *Kampung Adat Cireundeu* di Leuwigajah — kampung yang mempertahankan tradisi pangan singkat sebagai makanan pokok, bukan beras.',
    '',
    'Untuk daftar destinasi lengkap, agenda wisata, dan jam kunjungan yang sedang berlaku, cek kanal resmi di cimahikota.go.id — informasinya diperbarui di sana.',
    '',
    'Berencana berkunjung rombongan atau butuh izin kegiatan? Pilih *Layanan Publik* dari menu.',
  ].join('\n'),
  2,
)

leaf(
  'cctv',
  'b_cctv',
  [
    '📹 *CCTV Online*',
    '',
    'Titik-titik strategis Kota Cimahi dipantau secara real-time dari *Cimahi Command Center*.',
    '',
    'Pemantauan dipakai untuk lalu lintas, keamanan lingkungan, dan respons kejadian. Akses tayangannya diatur sesuai ketentuan yang berlaku.',
    '',
    'Melihat kejadian yang perlu ditindak? Pilih *Pengaduan* dari menu, atau telepon *112* kalau mendesak.',
  ].join('\n'),
  3,
)

leaf(
  'kejaksaan',
  'b_kejaksaan',
  [
    '⚖️ *Kejaksaan Negeri Cimahi*',
    '',
    'Layanan informasi yang tersedia:',
    '',
    '• *e-Tilang* — informasi dan penyelesaian tilang elektronik',
    '• *Rumah RJ* — Restorative Justice, penyelesaian perkara lewat musyawarah',
    '• *BAROS* — layanan informasi hukum untuk masyarakat',
    '',
    'Untuk perkara yang sedang berjalan, siapkan nomor perkara atau nomor tilang supaya lebih cepat ditelusuri.',
  ].join('\n'),
  4,
)

leaf(
  'mbg',
  'b_mbg',
  [
    '🍱 *Makan Bergizi Gratis*',
    '',
    'Informasi yang bisa dibantu di sini:',
    '',
    '• *SPPG* — Satuan Pelayanan Pemenuhan Gizi, dapur yang menyiapkan makanan',
    '• *Penerima Manfaat* — siapa saja yang berhak dan bagaimana pendataannya',
    '• *Pengaduan* — laporan soal kualitas, jumlah, atau distribusi makanan',
    '• *Mitra BGN* — informasi untuk yang ingin menjadi mitra penyedia',
    '',
    'Ada masalah pada makanan yang diterima? Pilih *Pengaduan* dari menu dan sebutkan nama sekolah atau lokasinya.',
  ].join('\n'),
  5,
)

// -------------------------------------------------- layanan publik submenu

add(
  'b_layanan',
  {
    kind: 'sendList',
    header: 'Layanan Publik',
    body: 'WA Mantap terhubung dengan sistem layanan Kota Cimahi. Pilih yang dibutuhkan:',
    footer: 'Tanpa perlu datang ke kantor',
    buttonText: 'Pilih Layanan',
    sections: [
      {
        title: 'Administrasi',
        rows: [
          { id: 'l_dilandacita', title: 'Kependudukan', description: 'Dilandacita — KTP, KK, akta' },
          { id: 'l_lapakami', title: 'Kelurahan & Kecamatan', description: 'Lapakami — surat pengantar' },
          { id: 'l_mpp', title: 'Antrean MPP', description: 'Mal Pelayanan Publik' },
        ],
      },
      {
        title: 'Lainnya',
        rows: [
          { id: 'l_kerja', title: 'Pencari Kerja', description: 'Sidakeptri — kartu kuning' },
          { id: 'l_elib', title: 'Perpustakaan Digital', description: 'e-Lib Kota Cimahi' },
        ],
      },
    ],
  },
  6 * COL,
  ROW_Y,
)
link('menu', 'b_layanan', 'layanan')

const LAYANAN: [string, string, string[]][] = [
  [
    'l_dilandacita',
    'Kependudukan',
    [
      '🆔 *Layanan Kependudukan — Dilandacita*',
      '',
      'Pengurusan dokumen kependudukan Kota Cimahi: KTP-el, Kartu Keluarga, akta kelahiran, akta kematian, dan perubahan data.',
      '',
      'Siapkan lebih dulu:',
      '• NIK dan Kartu Keluarga',
      '• Dokumen pendukung sesuai jenis pengurusan',
      '',
      'Permohonan bisa diajukan tanpa datang ke kantor, dan status prosesnya bisa dipantau.',
    ],
  ],
  [
    'l_lapakami',
    'Kelurahan & Kecamatan',
    [
      '🏛️ *Layanan Kelurahan & Kecamatan — Lapakami*',
      '',
      'Pengurusan administrasi di tingkat kelurahan dan kecamatan: surat pengantar, surat keterangan domisili, keterangan usaha, dan sejenisnya.',
      '',
      'Sebutkan kelurahan tempat tinggal dan jenis surat yang dibutuhkan supaya bisa diarahkan ke petugas yang tepat.',
    ],
  ],
  [
    'l_mpp',
    'Antrean MPP',
    [
      '🎫 *Antrean Mal Pelayanan Publik*',
      '',
      'MPP menyatukan layanan berbagai instansi dalam satu lokasi. Pendaftaran antrean bisa dilakukan dari sini, jadi tidak perlu menunggu lama di tempat.',
      '',
      'Sebutkan jenis layanan dan tanggal yang diinginkan. Bawa dokumen asli saat datang.',
    ],
  ],
  [
    'l_kerja',
    'Pencari Kerja',
    [
      '💼 *Layanan Pencari Kerja — Sidakeptri*',
      '',
      'Pengurusan kartu pencari kerja (AK-1 atau "kartu kuning") dan informasi lowongan bagi warga Kota Cimahi.',
      '',
      'Siapkan KTP, Kartu Keluarga, ijazah terakhir, dan pas foto.',
    ],
  ],
  [
    'l_elib',
    'Perpustakaan Digital',
    [
      '📚 *Perpustakaan Digital — e-Lib Kota Cimahi*',
      '',
      'Koleksi buku digital yang bisa dipinjam warga Kota Cimahi tanpa datang ke perpustakaan.',
      '',
      'Pendaftaran keanggotaan cukup dengan NIK. Setelah terdaftar, peminjaman dan pengembalian berjalan otomatis sesuai masa pinjam.',
    ],
  ],
]

LAYANAN.forEach(([handle, , body], i) => {
  const id = `s_${handle}`
  add(id, { kind: 'sendText', body: body.join('\n') }, (6 + i) * COL, ROW_Y + 220)
  link('b_layanan', id, handle)
  link(id, 'lagi')
})

// ------------------------------------------------------------- pengaduan

add(
  'p_minta',
  {
    kind: 'sendText',
    body: [
      '📣 *Pengaduan*',
      '',
      'Silakan tuliskan keluhan atau aspirasi Wargi dalam *satu pesan*. Supaya cepat ditindaklanjuti, sebutkan juga:',
      '',
      '• Lokasi kejadian (RT/RW, kelurahan)',
      '• Kapan terjadinya',
      '• Kalau ada, foto bisa dikirim menyusul',
      '',
      'Laporan diteruskan ke perangkat daerah yang menangani lewat SIMPONI.',
    ].join('\n'),
  },
  -COL,
  ROW_Y,
)

add(
  'p_tunggu',
  {
    kind: 'waitReply',
    saveAs: 'aduan',
    expect: 'text',
    invalidMessage: 'Mohon tuliskan pengaduannya dalam bentuk teks ya, Wargi.',
    maxRetries: 2,
    timeoutMinutes: 180,
  },
  -COL,
  ROW_Y + 200,
)

add('p_tag', { kind: 'tag', action: 'add', tags: ['pengaduan'] }, -COL - 200, ROW_Y + 420)

add(
  'p_terima',
  {
    kind: 'sendText',
    body: [
      '✅ Terima kasih, pengaduan Wargi sudah kami terima.',
      '',
      '_"{{aduan}}"_',
      '',
      'Laporan ini diteruskan ke perangkat daerah terkait. Petugas kami akan menindaklanjuti lewat chat ini.',
    ].join('\n'),
  },
  -COL - 200,
  ROW_Y + 620,
)

add(
  'p_alih',
  {
    kind: 'handover',
    message: 'Sebentar ya Wargi, saya sambungkan ke petugas kami. 🙏',
  },
  -COL - 200,
  ROW_Y + 820,
)

add(
  'p_diam',
  {
    kind: 'sendText',
    body: [
      'Sepertinya Wargi belum sempat menuliskan pengaduannya.',
      '',
      'Tidak apa-apa — kirim saja *menu* kapan pun untuk mulai lagi. Kalau mendesak, telepon *112*.',
    ].join('\n'),
  },
  -COL + 220,
  ROW_Y + 420,
)

link('menu', 'p_minta', 'pengaduan')
link('p_minta', 'p_tunggu')
link('p_tunggu', 'p_tag', 'reply')
link('p_tunggu', 'p_diam', 'timeout')
link('p_tag', 'p_terima')
link('p_terima', 'p_alih')
link('p_diam', 'selesai')

// ------------------------------------------------------------------ tail

add(
  'lagi',
  {
    kind: 'sendButtons',
    body: 'Ada lagi yang bisa dibantu, Wargi?',
    footer: 'WA Mantap · 24 jam',
    buttons: [
      { id: 'lagi_menu', title: 'Menu Utama' },
      { id: 'lagi_selesai', title: 'Cukup, terima kasih' },
    ],
  },
  600,
  ROW_Y + 1040,
)

add(
  'tutup',
  {
    kind: 'sendText',
    body: [
      'Hatur nuhun, Wargi. 🙏',
      '',
      'Kirim *menu* kapan saja untuk membuka layanan ini lagi. WA Mantap aktif 24 jam.',
    ].join('\n'),
  },
  900,
  ROW_Y + 1240,
)

add('selesai', { kind: 'end', reason: 'Percakapan selesai' }, 600, ROW_Y + 1440)

link('lagi', 'menu', 'lagi_menu')
link('lagi', 'tutup', 'lagi_selesai')
link('tutup', 'selesai')

// ------------------------------------------------------------------ write

const graph: FlowGraph = { nodes, edges }
const issues = validateFlow(graph)
const errors = issues.filter((i) => i.severity === 'error')

console.log(`${nodes.length} node, ${edges.length} koneksi`)
for (const i of issues) console.log(`  [${i.severity}] ${i.message}`)

if (errors.length) {
  console.error(`\n${errors.length} error — draf tidak ditulis.`)
  process.exit(1)
}

await prisma.flow.update({
  where: { id: FLOW_ID },
  data: {
    name: 'WA Mantap — Layanan Kota Cimahi',
    draftGraph: graph as unknown as Prisma.InputJsonValue,
  },
})

console.log('\nDraf tersimpan. Buka editor untuk meninjau, lalu terbitkan sendiri.')
await prisma.$disconnect()
