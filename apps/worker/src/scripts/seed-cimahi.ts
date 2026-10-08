import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { prisma, Prisma } from '@wa/db'
import { loadEnvFile, ROUTE_CLARIFY_BODY, validateFlow, type FlowEdge, type FlowGraph, type FlowNode } from '@wa/core'

/**
 * Fills a flow with the Cimahi city-services menu.
 *
 * Written as a script rather than clicked into the editor because the graph is
 * ~180 nodes across 8 branches and four levels deep; laying that out by hand is
 * where mistakes hide. It writes the draft only - publishing stays a human
 * decision.
 *
 * The wording comes from wa-mantap-templates.json (produced by
 * tools/extract-wa-mantap.mjs out of the exported Wa Mantap chat history)
 * rather than being retyped here, so every body in the editor can be traced
 * back to a numbered template in that export.
 *
 * That export flattens interactive messages: a list's rows and a message's
 * reply buttons both survive only as trailing words inside the body. Those
 * tails are cut off and re-expressed as real rows and buttons, because that is
 * what turns them back into branches the engine can route on.
 */

loadEnvFile()

const here = dirname(fileURLToPath(import.meta.url))

// What Arahkan AI reads about a row instead of its message, in residents'
// words. Kept in a file of its own so apply-ai-hints.ts can put the same
// hints on a draft without seeding it again.
const aiHints = JSON.parse(readFileSync(resolve(here, 'cimahi-ai-hints.json'), 'utf8')) as Record<string, string>

const FLOW_ID = process.argv[2]
if (!FLOW_ID) {
  console.error('Usage: tsx src/scripts/seed-cimahi.ts <flowId>')
  process.exit(1)
}

const target = await prisma.flow.findUnique({ where: { id: FLOW_ID }, select: { orgId: true } })
if (!target) {
  console.error(`Flow ${FLOW_ID} tidak ditemukan.`)
  process.exit(1)
}
// Arahkan AI needs a router endpoint. Without one the node is still laid
// out, and publishing stays blocked until an admin picks one in the editor.
const router = await prisma.aiEndpoint.findFirst({
  where: { orgId: target.orgId, kind: 'ROUTE' },
  orderBy: { createdAt: 'asc' },
  select: { id: true, name: true },
})

const templates: Record<string, string> = JSON.parse(
  readFileSync(resolve(here, 'wa-mantap-templates.json'), 'utf8'),
)

/**
 * Template `n`, optionally truncated at `cut`.
 *
 * Both lookups throw rather than fall back: a missing template or a marker that
 * no longer matches means the export changed, and silently publishing a
 * half-empty message body would be worse than failing here.
 */
function T(n: number, cut?: string): string {
  const raw = templates[String(n)]
  if (raw === undefined) throw new Error(`Template ${n} tidak ada di export.`)
  if (!cut) return raw.trim()
  const i = raw.indexOf(cut)
  if (i < 0) throw new Error(`Penanda potong "${cut}" tidak ketemu di template ${n}.`)
  return raw.slice(0, i).trimEnd()
}

/** Drops one exact phrase, failing loudly if the export no longer contains it. */
function without(body: string, phrase: string): string {
  if (!body.includes(phrase)) throw new Error(`Frasa "${phrase}" sudah tidak ada di template.`)
  return body.replace(phrase, '')
}

// ---------------------------------------------------------------- graph DSL

const nodes: FlowNode[] = []
const edges: FlowEdge[] = []

/**
 * Where a node should hang in the drawn tree, when that differs from the first
 * path the engine happens to reach it by. A shared "Kembali" bar belongs under
 * the menu it returns to, not under whichever leaf was laid out first.
 */
const layoutParent = new Map<string, string>()

function add(node: Omit<FlowNode, 'position'>) {
  nodes.push({ ...node, position: { x: 0, y: 0 } } as FlowNode)
}

function link(source: string, target: string, sourceHandle?: string) {
  edges.push({ id: `${source}--${sourceHandle ?? ''}--${target}`, source, target, sourceHandle })
}

function text(id: string, body: string, next: string) {
  add({ id, type: 'sendText', data: { kind: 'sendText', body } })
  link(id, next)
}

interface Row {
  id: string
  title: string
  description?: string
  to: string
}

function list(
  id: string,
  opts: { body: string; footer?: string; buttonText?: string; sectionTitle?: string; rows: Row[] },
) {
  add({
    id,
    type: 'sendList',
    data: {
      kind: 'sendList',
      body: opts.body,
      footer: opts.footer,
      buttonText: opts.buttonText ?? 'Buka Menu',
      sections: [
        {
          title: opts.sectionTitle ?? 'Pilihan',
          rows: opts.rows.map(({ to: _to, ...r }) => (aiHints[r.id] ? { ...r, aiHint: aiHints[r.id] } : r)),
        },
      ],
    },
  })
  for (const r of opts.rows) link(id, r.to, r.id)
}

function buttons(id: string, opts: { body: string; buttons: { id: string; title: string; to: string }[] }) {
  add({
    id,
    type: 'sendButtons',
    data: {
      kind: 'sendButtons',
      body: opts.body,
      buttons: opts.buttons.map(({ to: _to, ...b }) => b),
    },
  })
  for (const b of opts.buttons) link(id, b.to, b.id)
}

/**
 * The three-button bar every leaf message ends with in the real bot.
 *
 * One bar per submenu, shared by that submenu's leaves, because "Kembali" has
 * to land on the menu the contact actually came from.
 */
function nav(id: string, back: string) {
  buttons(id, {
    body: 'Ada lagi yang bisa dibantu, Wargi?',
    buttons: [
      { id: `${id}_back`, title: 'Kembali', to: back },
      { id: `${id}_menu`, title: 'Menu Utama', to: 'menu' },
      { id: `${id}_done`, title: 'Selesai', to: 'tutup' },
    ],
  })
  layoutParent.set(id, back)
}

// ------------------------------------------------------------------- shared

add({
  id: 'trigger',
  type: 'trigger',
  data: {
    kind: 'trigger',
    match: 'keyword',
    values: ['halo', 'hai', 'menu', 'sampurasun', 'assalamualaikum', 'mulai'],
    caseSensitive: false,
  },
})
link('trigger', 'welcome')

// The export is one person's chat history, so the greeting still carries their
// name. It is dropped rather than swapped for {{contact.name}}: interpolate()
// has no fallback, and an unknown contact would be greeted "Selamat datang **".
text('welcome', without(T(1), '*Ahmad* '), 'menu')

// A question typed in the contact's own words ("cara bikin skck") matches no
// keyword above. Instead of going unanswered it is routed straight to the
// menu row it belongs to - one billed message instead of the six or seven a
// walk down the menus costs. Unsure or failing, it falls back to the greeting
// and main menu, which is what typing "menu" gives anyway.
add({
  id: 'trigger_ai',
  type: 'trigger',
  data: { kind: 'trigger', match: 'fallback', values: [], caseSensitive: false },
})
link('trigger_ai', 'arahkan')
add({
  id: 'arahkan',
  type: 'aiRoute',
  data: {
    kind: 'aiRoute',
    endpointId: router?.id ?? '',
    question: 'pesan_awal',
    minScore: 0.7,
    // Torn between a few rows, ask with one list rather than the whole menu.
    clarify: true,
    clarifyMinScore: 0.5,
    clarifyBody: ROUTE_CLARIFY_BODY,
    saveAs: 'arah_ai',
  },
})
link('arahkan', 'welcome', 'unsure')
link('arahkan', 'welcome', 'error')

text('tutup', T(64), 'selesai')
layoutParent.set('tutup', 'menu')
add({ id: 'selesai', type: 'end', data: { kind: 'end', reason: 'Percakapan selesai' } })

// Root-level leaves get a two-button bar: at depth one, "Kembali" and
// "Menu Utama" would land on the same node.
buttons('nav_root', {
  body: 'Ada lagi yang bisa dibantu, Wargi?',
  buttons: [
    { id: 'nav_root_menu', title: 'Menu Utama', to: 'menu' },
    { id: 'nav_root_done', title: 'Selesai', to: 'tutup' },
  ],
})
layoutParent.set('nav_root', 'menu')

// ---------------------------------------------------------------- main menu

list('menu', {
  body: 'Silakan pilih *Menu* layanan yang Wargi butuhkan:',
  buttonText: 'Menu Utama',
  sectionTitle: 'Layanan Wa Mantap',
  rows: [
    { id: 'm_darurat', title: 'Kedaruratan', description: 'Lapor situasi darurat lewat 112', to: 'd_112' },
    { id: 'm_pengaduan', title: 'Pengaduan', description: 'Keluhan dan aspirasi untuk Pemkot Cimahi', to: 'pg_menu' },
    { id: 'm_info', title: 'Informasi Kota Cimahi', description: 'Open Data, PPID, dan berita Bewara', to: 'ik_menu' },
    { id: 'm_layanan', title: 'Layanan Publik', description: 'MPP, Disdukcapil, kecamatan, dan badan daerah', to: 'lp_menu' },
    { id: 'm_wisata', title: 'Pariwisata', description: 'Destinasi wisata Kota Cimahi', to: 'ws_menu' },
    { id: 'm_cctv', title: 'CCTV', description: 'Pantau titik strategis kota secara real-time', to: 'cc_info' },
    { id: 'm_kejaksaan', title: 'Kejaksaan Negeri', description: 'e-Tilang, Rumah RJ, BAROS, SI-WALI', to: 'kj_menu' },
    { id: 'm_mbg', title: 'Makan Bergizi Gratis', description: 'SPPG, penerima manfaat, pengaduan, mitra BGN', to: 'mb_menu' },
  ],
})

// 1 ----------------------------------------------------------- kedaruratan

text('d_112', T(3), 'nav_root')

// 2 ------------------------------------------------------------- pengaduan

list('pg_menu', {
  body: T(4, 'Silakan pilih *Layanan Pengaduan*'),
  buttonText: 'Pilih Layanan',
  sectionTitle: 'Layanan Pengaduan',
  rows: [
    { id: 'pg_lapor', title: 'SP4N LAPOR', description: 'Kanal pengaduan nasional lapor.go.id', to: 'pg_lapor_txt' },
    { id: 'pg_tulis', title: 'Tulis Pengaduan', description: 'Sampaikan keluhan langsung di chat ini', to: 'p_minta' },
    { id: 'pg_wali', title: 'WA Sampurasun Wali Kota', description: 'Fast response Wali Kota & Wakil Wali Kota', to: 'pg_wali_txt' },
    { id: 'pg_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_pg', 'pg_menu')
text('pg_lapor_txt', T(5), 'nav_pg')
text('pg_wali_txt', T(6), 'nav_pg')

// Free-text pengaduan is collected here and handed to a human. The bot has
// nowhere to file it, so closing the loop itself would be a lie.
text(
  'p_minta',
  'Silakan tuliskan keluhan atau aspirasi Wargi dalam *satu pesan*. 📝\n\nSertakan lokasi dan waktu kejadian bila ada, supaya petugas lebih cepat menindaklanjuti.',
  'p_tunggu',
)
add({
  id: 'p_tunggu',
  type: 'waitReply',
  data: {
    kind: 'waitReply',
    saveAs: 'aduan',
    expect: 'text',
    invalidMessage: 'Mohon tuliskan pengaduannya dalam bentuk teks ya, Wargi.',
    maxRetries: 2,
    timeoutMinutes: 180,
  },
})
link('p_tunggu', 'p_tag', 'reply')
link('p_tunggu', 'p_diam', 'timeout')
add({ id: 'p_tag', type: 'tag', data: { kind: 'tag', action: 'add', tags: ['pengaduan'] } })
link('p_tag', 'p_terima')
text(
  'p_terima',
  '✅ Terima kasih, pengaduan Wargi sudah kami terima.\n\n_"{{aduan}}"_\n\nLaporan diteruskan ke petugas untuk ditindaklanjuti.',
  'p_alih',
)
add({
  id: 'p_alih',
  type: 'handover',
  data: { kind: 'handover', message: 'Sebentar ya Wargi, saya sambungkan ke petugas kami. 🙏' },
})
text(
  'p_diam',
  'Sepertinya Wargi belum sempat menuliskan pengaduannya.\n\nTidak apa-apa — kirim *menu* kapan saja untuk membuka layanan ini lagi. 🙏',
  'selesai',
)

// 3 -------------------------------------------------- informasi kota cimahi

list('ik_menu', {
  body: T(7, 'Silakan pilih *Menu* untuk melanjutkan:'),
  buttonText: 'Pilih Informasi',
  sectionTitle: 'Informasi Kota',
  rows: [
    { id: 'ik_opendata', title: 'Open Data', description: 'Pusat data terbuka Kota Cimahi', to: 'ik_opendata_txt' },
    { id: 'ik_ppid', title: 'PPID (SIMPONI)', description: 'Permohonan informasi publik', to: 'ik_ppid_txt' },
    { id: 'ik_bewara', title: 'Bewara Cimahi MANTAP', description: 'Berita dan agenda terkini Kota Cimahi', to: 'ik_bewara_txt' },
    { id: 'ik_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_ik', 'ik_menu')
text('ik_opendata_txt', T(8), 'nav_ik')
text('ik_ppid_txt', T(9), 'nav_ik')
text('ik_bewara_txt', T(10), 'nav_ik')

// 4 --------------------------------------------------------- layanan publik

list('lp_menu', {
  body: T(11, ' MPP\nMal Pelayanan Publik'),
  buttonText: 'Pilih Unit',
  sectionTitle: 'Unit Layanan',
  rows: [
    { id: 'lp_mpp', title: 'Mal Pelayanan Publik', description: 'Layanan terpadu berbagai instansi di satu gedung', to: 'mpp_menu' },
    { id: 'lp_disdukcapil', title: 'Disdukcapil', description: 'Kependudukan dan pencatatan sipil', to: 'dc_menu' },
    { id: 'lp_kecamatan', title: 'Kecamatan & Kelurahan', description: 'Lapakami dan website kecamatan/kelurahan', to: 'kk_menu' },
    { id: 'lp_bakesbangpol', title: 'Bakesbangpol', description: 'Kesatuan bangsa dan politik', to: 'bk_menu' },
    { id: 'lp_bpbd', title: 'BPBD', description: 'Penanggulangan bencana daerah', to: 'lp_bpbd_txt' },
    { id: 'lp_bpkad', title: 'BPKAD', description: 'Pengelolaan keuangan dan aset daerah', to: 'lp_bpkad_txt' },
    { id: 'lp_bappenda', title: 'Bappenda', description: 'Pajak daerah, Wajib Pajak Online, dan BPHTB', to: 'bp_menu' },
    { id: 'lp_bappelitbangda', title: 'Bappelitbangda', description: 'Perencanaan pembangunan dan inovasi daerah', to: 'bl_menu' },
    { id: 'lp_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_lp', 'lp_menu')
text('lp_bpbd_txt', T(96), 'nav_lp')
text('lp_bpkad_txt', T(97), 'nav_lp')

// 4.1 ------------------------------------------------- mal pelayanan publik

list('mpp_menu', {
  body: T(12, 'Silakan pilih *Tenant* untuk melanjutkan:'),
  buttonText: 'Pilih Tenant',
  sectionTitle: 'Tenant MPP',
  rows: [
    { id: 'mp_dekranasda', title: 'Dekranasda', description: 'Dewan Kerajinan Nasional Daerah', to: 'mp_dekranasda_txt' },
    { id: 'mp_imigrasi', title: 'Imigrasi (Paspor)', description: 'Permohonan dan penggantian paspor', to: 'mp_imigrasi_txt' },
    { id: 'mp_bnn', title: 'BNN Kota Cimahi', description: 'SKHPN, rehabilitasi, penyuluhan narkoba', to: 'bnn_menu' },
    { id: 'mp_pa', title: 'Pengadilan Agama', description: 'e-Court, gugatan mandiri, informasi produk', to: 'pa_menu' },
    { id: 'mp_samsat', title: 'Samsat (Pajak Kendaraan)', description: 'Pembayaran dan pengesahan pajak tahunan', to: 'mp_samsat_txt' },
    { id: 'mp_polres', title: 'Polres Cimahi (SKCK)', description: 'Surat Keterangan Catatan Kepolisian', to: 'mp_polres_txt' },
    { id: 'mp_pegadaian', title: 'PT Pegadaian', description: 'KCA, cicil emas, Arrum Haji, dan lainnya', to: 'pgd_menu' },
    { id: 'mp_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_mpp', 'mpp_menu')
text('mp_dekranasda_txt', T(13), 'nav_mpp')
text('mp_imigrasi_txt', `${T(14, 'Silakan pilih *Menu* untuk melanjutkan:')}\n\n${T(15)}`, 'nav_mpp')
text('mp_samsat_txt', `${T(39, 'Silakan pilih *Menu* untuk melanjutkan:')}\n\n${T(40)}`, 'nav_mpp')
text('mp_polres_txt', `${T(43, 'Silakan pilih *Menu* untuk melanjutkan:')}\n\n${T(44)}`, 'nav_mpp')

list('bnn_menu', {
  body: T(19, 'Silakan pilih *Menu* untuk melanjutkan:'),
  buttonText: 'Pilih Layanan',
  sectionTitle: 'Layanan BNN',
  rows: [
    { id: 'bn_skhpn', title: 'SKHPN', description: 'Surat Keterangan Hasil Pemeriksaan Narkotika', to: 'bn_skhpn_txt' },
    { id: 'bn_rehab', title: 'Konsultasi Rehabilitasi', description: 'Rawat jalan dan rujukan rawat inap, gratis', to: 'bn_rehab_txt' },
    { id: 'bn_suluh', title: 'Penyuluhan Narkoba', description: 'Layanan penyuluhan narkoba untuk masyarakat', to: 'bn_suluh_txt' },
    { id: 'bn_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_bnn', 'bnn_menu')
text('bn_skhpn_txt', T(20, ' 129. Booking Antrian'), 'nav_bnn')
text('bn_rehab_txt', T(23, ' 130. Booking Antrian'), 'nav_bnn')
text('bn_suluh_txt', T(26, ' 131. Booking Antrian'), 'nav_bnn')

list('pa_menu', {
  body: T(29, 'Silakan pilih *Menu* untuk melanjutkan:'),
  buttonText: 'Pilih Layanan',
  sectionTitle: 'Pengadilan Agama',
  rows: [
    { id: 'pa_ecourt', title: 'e-Court', description: 'e-Filing, e-Payment, e-Summons, e-Litigation', to: 'pa_ecourt_txt' },
    { id: 'pa_gugatan', title: 'Gugatan Mandiri', description: 'Buat gugatan sendiri lewat aplikasi, gratis', to: 'pa_gugatan_txt' },
    { id: 'pa_ipp', title: 'Informasi Produk', description: 'Informasi produk dan layanan pengadilan', to: 'pa_ipp_txt' },
    { id: 'pa_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_pa', 'pa_menu')
text('pa_ecourt_txt', T(30, ' 103. Booking Antrian'), 'nav_pa')
text('pa_gugatan_txt', T(33, ' 104.Booking Antrian'), 'nav_pa')
text('pa_ipp_txt', T(36, ' 105. Booking Antrian'), 'nav_pa')

list('pgd_menu', {
  body: T(47, 'Silakan pilih *Menu* untuk melanjutkan:'),
  buttonText: 'Pilih Layanan',
  sectionTitle: 'Layanan Pegadaian',
  rows: [
    { id: 'pd_kca', title: 'Kredit Cepat Aman (KCA)', description: 'Pinjaman tunai dengan sistem gadai', to: 'pd_kca_txt' },
    { id: 'pd_cicil', title: 'Pegadaian Cicil Emas', description: 'Beli emas batangan secara cicilan', to: 'pd_cicil_txt' },
    { id: 'pd_arrum', title: 'Arrum Haji Pegadaian', description: 'Pembiayaan porsi haji sesuai prinsip syariah', to: 'pd_arrum_txt' },
    { id: 'pd_lainnya', title: 'Layanan Lainnya', description: 'KUR Syariah, AMANAH, KREASI, Agen Pegadaian', to: 'pd_lainnya_txt' },
    { id: 'pd_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_pgd', 'pgd_menu')
text('pd_kca_txt', T(48, ' 186. Booking Antrian'), 'nav_pgd')
text('pd_cicil_txt', T(51, ' 230. Booking Antrian'), 'nav_pgd')
text('pd_arrum_txt', T(54, ' 231. Booking Antrian'), 'nav_pgd')
text(
  'pd_lainnya_txt',
  '🏛️ *Layanan Pegadaian Lainnya di MPP Kota Cimahi*\n\nSelain KCA, Cicil Emas, dan Arrum Haji, tenant Pegadaian di MPP Kota Cimahi juga melayani:\n\n• *KUR Syariah* — pembiayaan usaha mikro sesuai prinsip syariah\n• *AMANAH* — pembiayaan kepemilikan kendaraan secara cicilan\n• *KREASI* — pinjaman usaha dengan jaminan BPKB kendaraan\n• *Kreasi Multiguna* — pinjaman multiguna dengan jaminan BPKB\n• *Agen Pegadaian* — kemitraan layanan Pegadaian\n\n📍 Informasi dan pengajuan dapat dilakukan langsung di tenant *Pegadaian* Mal Pelayanan Publik Kota Cimahi.',
  'nav_pgd',
)

// 4.2 ---------------------------------------------------------- disdukcapil

list('dc_menu', {
  body: '🆔 *Dinas Kependudukan dan Pencatatan Sipil Kota Cimahi*\n\nUrusan administrasi kependudukan kini bisa diakses secara online. Silakan pilih *Menu:*',
  buttonText: 'Pilih Layanan',
  sectionTitle: 'Layanan Disdukcapil',
  rows: [
    { id: 'dc_dilanda', title: 'DILANDACITA', description: 'Digitalisasi Layanan Adminduk Cimahi Kota', to: 'dl_menu' },
    { id: 'dc_sipanen', title: 'SIPANEN', description: 'Pendataan penduduk nonpermanen', to: 'dc_sipanen_txt' },
    { id: 'dc_jebol', title: 'JEBOLBAWATAS', description: 'Jemput bola perekaman KTP-el lansia & disabilitas', to: 'dc_jebol_txt' },
    { id: 'dc_web', title: 'Website Disdukcapil', description: 'Situs resmi Disdukcapil Kota Cimahi', to: 'dc_web_txt' },
    { id: 'dc_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_dc', 'dc_menu')
text('dc_sipanen_txt', T(66), 'nav_dc')
text('dc_jebol_txt', T(67), 'nav_dc')
text('dc_web_txt', T(68), 'nav_dc')

list('dl_menu', {
  body: '🌐 *DILANDACITA — Digitalisasi Layanan Adminduk Cimahi Kota*\n\nSilakan pilih *Menu* untuk melanjutkan:',
  buttonText: 'Pilih Layanan',
  sectionTitle: 'Dilandacita',
  rows: [
    { id: 'dl_info', title: 'Deskripsi & Persyaratan', description: 'Apa itu Dilandacita dan apa saja syaratnya', to: 'dl_info_txt' },
    { id: 'dl_mohon', title: 'Permohonan Layanan', description: 'Ajukan permohonan adminduk secara online', to: 'dl_mohon_txt' },
    { id: 'dl_lacak', title: 'Lacak Status Permohonan', description: 'Cek status permohonan dengan PIN', to: 'dl_lacak_minta' },
    { id: 'dl_panduan', title: 'Panduan', description: 'Unduh buku panduan penggunaan aplikasi', to: 'dl_panduan_txt' },
    { id: 'dl_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_dl', 'dl_menu')
text('dl_info_txt', T(59), 'nav_dl')
text('dl_mohon_txt', T(60), 'nav_dl')
text('dl_panduan_txt', T(65), 'nav_dl')

// Status lookup needs the Dilandacita backend, which this bot cannot reach. It
// collects the PIN and hands the conversation to a petugas rather than
// inventing a result.
text('dl_lacak_minta', T(62), 'dl_lacak_tunggu')
add({
  id: 'dl_lacak_tunggu',
  type: 'waitReply',
  data: {
    kind: 'waitReply',
    saveAs: 'pin_dilandacita',
    expect: 'text',
    invalidMessage: 'Mohon kirim *PIN* permohonan Dilandacita Wargi ya.',
    maxRetries: 2,
    timeoutMinutes: 60,
  },
})
link('dl_lacak_tunggu', 'dl_lacak_terima', 'reply')
link('dl_lacak_tunggu', 'dl_lacak_diam', 'timeout')
text(
  'dl_lacak_terima',
  '🔎 PIN *{{pin_dilandacita}}* sudah kami terima.\n\nStatus permohonan akan dicek oleh petugas Disdukcapil. Mohon tunggu sebentar ya, Wargi. 🙏',
  'dl_lacak_alih',
)
add({
  id: 'dl_lacak_alih',
  type: 'handover',
  data: { kind: 'handover', message: 'Saya sambungkan ke petugas Disdukcapil untuk pengecekan status. 🙏' },
})
text(
  'dl_lacak_diam',
  'Sepertinya Wargi belum sempat mengirim PIN permohonan.\n\nKirim *menu* kapan saja untuk membuka layanan ini lagi. 🙏',
  'selesai',
)

// 4.3 ------------------------------------------------ kecamatan & kelurahan

list('kk_menu', {
  body: '🏛️ *Kecamatan dan Kelurahan Kota Cimahi*\n\nLayanan administrasi kelurahan/kecamatan dan website resmi tiap wilayah. Silakan pilih *Menu:*',
  buttonText: 'Pilih Menu',
  sectionTitle: 'Kecamatan & Kelurahan',
  rows: [
    { id: 'kk_lapakami', title: 'LAPAKAMI', description: 'Layanan surat kelurahan/kecamatan tanpa antre', to: 'lk_menu' },
    { id: 'kk_utara', title: 'Kecamatan Cimahi Utara', description: 'Cibabat, Cipageran, Citeureup, Pasirkaliki', to: 'cu_menu' },
    { id: 'kk_selatan', title: 'Kecamatan Cimahi Selatan', description: 'Cibeber, Cibeureum, Leuwigajah, Melong, Utama', to: 'cs_menu' },
    { id: 'kk_tengah', title: 'Kecamatan Cimahi Tengah', description: 'Baros, Cigugur Tengah, Cimahi, Karangmekar, dll', to: 'ct_menu' },
    { id: 'kk_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
// No nav bar here: every row leads to another menu, so nothing would ever
// arrive at one.

list('lk_menu', {
  body: T(70, 'Silakan pilih *Menu:*'),
  buttonText: 'Pilih Layanan',
  sectionTitle: 'Lapakami',
  rows: [
    { id: 'lk_info', title: 'Informasi Layanan', description: '25 jenis layanan surat yang tersedia', to: 'lk_info_txt' },
    { id: 'lk_mohon', title: 'Permohonan Layanan', description: 'Ajukan permohonan surat secara online', to: 'lk_mohon_txt' },
    { id: 'lk_lacak', title: 'Lacak Status Permohonan', description: 'Cek status permohonan dengan PIN', to: 'lk_lacak_minta' },
    { id: 'lk_bantuan', title: 'Pusat Bantuan', description: 'Bantuan penggunaan layanan Lapakami', to: 'lk_bantuan_txt' },
    { id: 'lk_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_lk', 'lk_menu')
text('lk_info_txt', T(71), 'nav_lk')
text(
  'lk_mohon_txt',
  '📝 *Permohonan Layanan Lapakami*\n\nAjukan surat keterangan kelurahan/kecamatan tanpa perlu antre di kantor. Siapkan dokumen persyaratan sesuai jenis layanan yang dipilih.\n\n🔗 Ajukan permohonan di: https://lapakami.cimahikota.go.id/layanan\n\nSetelah permohonan dikirim, Wargi akan menerima *PIN* yang bisa dipakai untuk melacak status permohonan.',
  'nav_lk',
)
text(
  'lk_bantuan_txt',
  '💁 *Pusat Bantuan Lapakami*\n\nAda kendala saat mengajukan permohonan? Wargi bisa:\n\n1️⃣ Mengecek kembali daftar dan persyaratan layanan di https://lapakami.cimahikota.go.id/layanan\n2️⃣ Mendatangi kantor kelurahan sesuai domisili untuk pendampingan\n3️⃣ Menyampaikan keluhan lewat menu *Pengaduan* di Wa Mantap\n\nKami siap membantu sampai urusan Wargi selesai. 🙏',
  'nav_lk',
)

text(
  'lk_lacak_minta',
  'Selamat datang di layanan cek status permohonan *LAPAKAMI*.\nSilakan masukkan *PIN* permohonan untuk melanjutkan layanan ini.',
  'lk_lacak_tunggu',
)
add({
  id: 'lk_lacak_tunggu',
  type: 'waitReply',
  data: {
    kind: 'waitReply',
    saveAs: 'pin_lapakami',
    expect: 'text',
    invalidMessage: 'Mohon kirim *PIN* permohonan Lapakami Wargi ya.',
    maxRetries: 2,
    timeoutMinutes: 60,
  },
})
link('lk_lacak_tunggu', 'lk_lacak_terima', 'reply')
link('lk_lacak_tunggu', 'lk_lacak_diam', 'timeout')
text(
  'lk_lacak_terima',
  '🔎 PIN *{{pin_lapakami}}* sudah kami terima.\n\nStatus permohonan akan dicek oleh petugas kelurahan. Mohon tunggu sebentar ya, Wargi. 🙏',
  'lk_lacak_alih',
)
add({
  id: 'lk_lacak_alih',
  type: 'handover',
  data: { kind: 'handover', message: 'Saya sambungkan ke petugas Lapakami untuk pengecekan status. 🙏' },
})
text(
  'lk_lacak_diam',
  'Sepertinya Wargi belum sempat mengirim PIN permohonan.\n\nKirim *menu* kapan saja untuk membuka layanan ini lagi. 🙏',
  'selesai',
)

list('cu_menu', {
  body: '🏢 *Kecamatan Cimahi Utara*\n\nSilakan pilih *Menu* untuk membuka website resmi kecamatan atau kelurahan:',
  buttonText: 'Pilih Wilayah',
  sectionTitle: 'Cimahi Utara',
  rows: [
    { id: 'cu_kec', title: 'Kecamatan Cimahi Utara', to: 'cu_kec_txt' },
    { id: 'cu_cibabat', title: 'Kelurahan Cibabat', to: 'cu_cibabat_txt' },
    { id: 'cu_cipageran', title: 'Kelurahan Cipageran', to: 'cu_cipageran_txt' },
    { id: 'cu_citeureup', title: 'Kelurahan Citeureup', to: 'cu_citeureup_txt' },
    { id: 'cu_pasirkaliki', title: 'Kelurahan Pasirkaliki', to: 'cu_pasirkaliki_txt' },
    { id: 'cu_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_cu', 'cu_menu')
text('cu_kec_txt', T(73), 'nav_cu')
text('cu_cibabat_txt', T(74), 'nav_cu')
text('cu_cipageran_txt', T(75), 'nav_cu')
text('cu_citeureup_txt', T(76), 'nav_cu')
text('cu_pasirkaliki_txt', T(77), 'nav_cu')

list('cs_menu', {
  body: '🏢 *Kecamatan Cimahi Selatan*\n\nSilakan pilih *Menu* untuk membuka website resmi kecamatan atau kelurahan:',
  buttonText: 'Pilih Wilayah',
  sectionTitle: 'Cimahi Selatan',
  rows: [
    { id: 'cs_kec', title: 'Kecamatan Cimahi Selatan', to: 'cs_kec_txt' },
    { id: 'cs_cibeber', title: 'Kelurahan Cibeber', to: 'cs_cibeber_txt' },
    { id: 'cs_cibeureum', title: 'Kelurahan Cibeureum', to: 'cs_cibeureum_txt' },
    { id: 'cs_leuwigajah', title: 'Kelurahan Leuwigajah', to: 'cs_leuwigajah_txt' },
    { id: 'cs_melong', title: 'Kelurahan Melong', to: 'cs_melong_txt' },
    { id: 'cs_utama', title: 'Kelurahan Utama', to: 'cs_utama_txt' },
    { id: 'cs_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_cs', 'cs_menu')
text('cs_kec_txt', T(79), 'nav_cs')
text('cs_cibeber_txt', T(80), 'nav_cs')
text('cs_cibeureum_txt', T(81), 'nav_cs')
text('cs_leuwigajah_txt', T(82), 'nav_cs')
text('cs_melong_txt', T(83), 'nav_cs')
text('cs_utama_txt', T(84), 'nav_cs')

list('ct_menu', {
  body: '🏢 *Kecamatan Cimahi Tengah*\n\nSilakan pilih *Menu* untuk membuka website resmi kecamatan atau kelurahan:',
  buttonText: 'Pilih Wilayah',
  sectionTitle: 'Cimahi Tengah',
  rows: [
    { id: 'ct_kec', title: 'Kecamatan Cimahi Tengah', to: 'ct_kec_txt' },
    { id: 'ct_baros', title: 'Kelurahan Baros', to: 'ct_baros_txt' },
    { id: 'ct_cigugur', title: 'Kelurahan Cigugur Tengah', to: 'ct_cigugur_txt' },
    { id: 'ct_cimahi', title: 'Kelurahan Cimahi', to: 'ct_cimahi_txt' },
    { id: 'ct_karangmekar', title: 'Kelurahan Karangmekar', to: 'ct_karangmekar_txt' },
    { id: 'ct_padasuka', title: 'Kelurahan Padasuka', to: 'ct_padasuka_txt' },
    { id: 'ct_setiamanah', title: 'Kelurahan Setiamanah', to: 'ct_setiamanah_txt' },
    { id: 'ct_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_ct', 'ct_menu')
text('ct_kec_txt', T(86), 'nav_ct')
text('ct_baros_txt', T(87), 'nav_ct')
text('ct_cigugur_txt', T(88), 'nav_ct')
text('ct_cimahi_txt', T(89), 'nav_ct')
text('ct_karangmekar_txt', T(90), 'nav_ct')
text('ct_padasuka_txt', T(91), 'nav_ct')
text('ct_setiamanah_txt', T(92), 'nav_ct')

// 4.4 -------------------------------------------------------- bakesbangpol

list('bk_menu', {
  body: '🤝 *Badan Kesatuan Bangsa dan Politik (Bakesbangpol) Kota Cimahi*\n\nSilakan pilih *Menu:*',
  buttonText: 'Pilih Menu',
  sectionTitle: 'Bakesbangpol',
  rows: [
    { id: 'bk_siomas', title: 'SIOMAS', description: 'Sistem Informasi Organisasi Kemasyarakatan', to: 'bk_siomas_txt' },
    { id: 'bk_web', title: 'Website Bakesbangpol', description: 'Layanan, program, dan kebijakan terbaru', to: 'bk_web_txt' },
    { id: 'bk_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_bk', 'bk_menu')
text('bk_siomas_txt', T(94), 'nav_bk')
text('bk_web_txt', T(95), 'nav_bk')

// 4.5 ------------------------------------------------------------ bappenda

list('bp_menu', {
  body: '💰 *Badan Pengelola Pendapatan Daerah (Bappenda) Kota Cimahi*\n\nSilakan pilih *Menu:*',
  buttonText: 'Pilih Layanan',
  sectionTitle: 'Bappenda',
  rows: [
    { id: 'bp_wpo', title: 'Wajib Pajak Online', description: 'Urusan perpajakan daerah secara daring', to: 'bp_wpo_txt' },
    { id: 'bp_bphtb', title: 'BPHTB', description: 'Bea Perolehan Hak atas Tanah dan Bangunan', to: 'bp_bphtb_txt' },
    { id: 'bp_web', title: 'Website Bappenda', description: 'Layanan, program, dan kebijakan Bappenda', to: 'bp_web_txt' },
    { id: 'bp_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_bp', 'bp_menu')
text('bp_wpo_txt', T(99), 'nav_bp')
text('bp_bphtb_txt', T(100), 'nav_bp')
text('bp_web_txt', T(101), 'nav_bp')

// 4.6 ------------------------------------------------------ bappelitbangda

list('bl_menu', {
  body: '📐 *Badan Perencanaan Pembangunan, Penelitian dan Pengembangan Daerah (Bappelitbangda) Kota Cimahi*\n\nSilakan pilih *Menu:*',
  buttonText: 'Pilih Menu',
  sectionTitle: 'Bappelitbangda',
  rows: [
    { id: 'bl_piramida', title: 'Piramida', description: 'Pusat Informasi Riset dan Manajemen Inovasi Daerah', to: 'bl_piramida_txt' },
    { id: 'bl_web', title: 'Website Bappelitbangda', description: 'Layanan, program, dan data perencanaan daerah', to: 'bl_web_txt' },
    { id: 'bl_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_bl', 'bl_menu')
text('bl_piramida_txt', T(103), 'nav_bl')
text('bl_web_txt', T(104), 'nav_bl')

// 5 ------------------------------------------------------------- pariwisata

list('ws_menu', {
  body: T(105, 'Silakan pilih *Menu:*'),
  buttonText: 'Pilih Destinasi',
  sectionTitle: 'Destinasi Cimahi',
  rows: [
    { id: 'ws_eco', title: 'Eco Wisata Cimahi', description: 'Wisata alam di Cipageran, tiket gratis', to: 'ws_eco_txt' },
    { id: 'ws_awc', title: 'Alam Wisata Cimahi', description: 'One stop recreation di jalur utara Cimahi', to: 'ws_awc_txt' },
    { id: 'ws_kabuci', title: 'Kampung Buyut Cipageran', description: 'Camping, resort, dan venue di lahan 2,5 ha', to: 'ws_kabuci_txt' },
    { id: 'ws_ciseupan', title: 'Teras Ciseupan', description: 'Wisata alam dengan view spektakuler di Cibeber', to: 'ws_ciseupan_txt' },
    { id: 'ws_cimiteg', title: 'Cimahi Military Heritage', description: 'Jejak sejarah militer Kota Cimahi', to: 'ws_cimiteg_txt' },
    { id: 'ws_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_ws', 'ws_menu')
text('ws_eco_txt', T(106), 'nav_ws')
text('ws_awc_txt', T(107), 'nav_ws')
text('ws_kabuci_txt', T(108), 'nav_ws')
text('ws_ciseupan_txt', T(109), 'nav_ws')
text('ws_cimiteg_txt', T(110), 'nav_ws')

// 6 ------------------------------------------------------------------- cctv

text('cc_info', T(111), 'nav_root')

// 7 -------------------------------------------------------------- kejaksaan

list('kj_menu', {
  body: T(112, ' e-Tilang Rumah RJ BAROS'),
  buttonText: 'Pilih Layanan',
  sectionTitle: 'Kejaksaan Negeri',
  rows: [
    { id: 'kj_etilang', title: 'e-Tilang', description: 'Cara bayar denda dan ambil sisa titipan', to: 'et_menu' },
    { id: 'kj_rj', title: 'Rumah RJ', description: 'Restorative Justice, Halo JPN, penyuluhan hukum', to: 'rj_menu' },
    { id: 'kj_baros', title: 'Barang Bukti (BAROS)', description: 'Pengambilan barang bukti bebas ongkos', to: 'kj_baros_txt' },
    { id: 'kj_siwali', title: 'SI-WALI', description: 'Sistem Informasi Perwalian Anak', to: 'kj_siwali_txt' },
    { id: 'kj_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_kj', 'kj_menu')
text('kj_baros_txt', T(123), 'nav_kj')
text('kj_siwali_txt', T(124), 'nav_kj')

list('et_menu', {
  body: T(113, 'Silakan pilih *Menu* untuk melanjutkan:'),
  buttonText: 'Pilih Menu',
  sectionTitle: 'e-Tilang',
  rows: [
    { id: 'et_cara', title: 'Cara Bayar', description: 'Langkah bayar denda tilang secara online', to: 'et_cara_menu' },
    { id: 'et_sisa', title: 'Pengambilan Sisa Titipan', description: 'Ambil sisa uang titipan sidang lewat BRI', to: 'et_sisa_txt' },
    { id: 'et_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_et', 'et_menu')
text('et_sisa_txt', T(117), 'nav_et')

list('et_cara_menu', {
  body: T(114, ' Bayar via Bank/Pos'),
  buttonText: 'Pilih Cara Bayar',
  sectionTitle: 'Cara Pembayaran',
  rows: [
    { id: 'et_bank', title: 'Bayar via Bank/Pos', description: 'Langkah pembayaran lewat teller bank atau Kantor Pos', to: 'et_bank_txt' },
    { id: 'et_tokped', title: 'Bayar via Tokopedia', description: 'Langkah pembayaran lewat aplikasi Tokopedia', to: 'et_tokped_txt' },
    { id: 'et_cara_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_etc', 'et_cara_menu')
text('et_bank_txt', T(115), 'nav_etc')
text('et_tokped_txt', T(116), 'nav_etc')

list('rj_menu', {
  body: '⚖️ *Rumah Restorative Justice (RJ) — Kejaksaan Negeri Cimahi*\n\nWadah penyelesaian perkara di luar pengadilan dengan pendekatan damai dan humanis. Silakan pilih *Menu:*',
  buttonText: 'Pilih Layanan',
  sectionTitle: 'Rumah RJ',
  rows: [
    { id: 'rj_rumah', title: 'Rumah RJ', description: 'Mediasi damai di rumah RJ tiap kelurahan', to: 'rj_rumah_txt' },
    { id: 'rj_jpn', title: 'Halo JPN', description: 'Konsultasi hukum gratis dengan Jaksa Pengacara Negara', to: 'rj_jpn_txt' },
    { id: 'rj_suluh', title: 'Permohonan Penyuluhan', description: 'Ajukan kegiatan penyuluhan hukum', to: 'rj_suluh_txt' },
    { id: 'rj_lapor', title: 'Laporan Pengaduan', description: 'Laporkan dugaan pelanggaran hukum', to: 'rj_lapor_txt' },
    { id: 'rj_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_rj', 'rj_menu')
text('rj_rumah_txt', T(119), 'nav_rj')
text('rj_jpn_txt', T(120), 'nav_rj')
text('rj_suluh_txt', T(121), 'nav_rj')
text('rj_lapor_txt', T(122), 'nav_rj')

// 8 ---------------------------------------------------- makan bergizi gratis

list('mb_menu', {
  body: T(125, 'Silakan pilih *Menu* untuk melanjutkan:'),
  buttonText: 'Pilih Menu',
  sectionTitle: 'Program MBG',
  rows: [
    { id: 'mb_sppg', title: 'SPPG', description: 'Satuan Pelayanan Pemenuhan Gizi per kelurahan', to: 'sp_kel' },
    { id: 'mb_penerima', title: 'Lembaga Penerima Manfaat', description: 'Siapa saja yang menerima manfaat program MBG', to: 'mb_penerima_txt' },
    { id: 'mb_aduan', title: 'Pengaduan', description: 'Sampaikan keluhan terkait layanan MBG', to: 'mb_aduan_txt' },
    { id: 'mb_mitra', title: 'Mitra BGN', description: 'Kemitraan dengan Badan Gizi Nasional', to: 'mb_mitra_txt' },
    { id: 'mb_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_mb', 'mb_menu')
text(
  'mb_penerima_txt',
  '👥 *Lembaga Penerima Manfaat Program MBG*\n\nProgram Makan Bergizi Gratis menyasar kelompok yang paling membutuhkan pemenuhan gizi, yaitu:\n\n👧 Anak-anak\n🧑🏻‍🎓 Peserta didik (PAUD/TK, SD, SMP, SMA/SMK sederajat)\n🤰 Ibu hamil\n🤱 Ibu menyusui\n\nPenyalurannya dilakukan lewat *SPPG* (Satuan Pelayanan Pemenuhan Gizi) di tiap kelurahan, bekerja sama dengan sekolah, madrasah, PAUD/Kober, dan posyandu setempat.\n\n📍 Untuk melihat daftar sekolah dan posyandu penerima manfaat di wilayah Wargi, pilih menu *SPPG* lalu pilih kelurahannya.',
  'nav_mb',
)
text(
  'mb_aduan_txt',
  '📣 *Pengaduan Program MBG*\n\nMenemukan kendala pada layanan Makan Bergizi Gratis — mutu makanan, jadwal distribusi, atau data penerima manfaat?\n\nWargi bisa menyampaikannya lewat:\n\n1️⃣ *SP4N LAPOR!* — kanal pengaduan resmi pemerintah\n🔗 https://www.lapor.go.id\n\n2️⃣ *Menu Pengaduan* di Wa Mantap — tulis keluhan Wargi langsung di chat ini, laporan akan diteruskan ke petugas\n\n3️⃣ *SPPG setempat* — sampaikan langsung ke yayasan pengelola SPPG di kelurahan Wargi (alamatnya ada di menu *SPPG*)\n\nSetiap laporan ditindaklanjuti sesuai ketentuan yang berlaku. 🙏',
  'nav_mb',
)
text(
  'mb_mitra_txt',
  '🤝 *Mitra Badan Gizi Nasional (BGN)*\n\nProgram MBG dijalankan *Badan Gizi Nasional* melalui SPPG yang dikelola yayasan mitra di tiap daerah, sesuai *Peraturan Presiden Nomor 83 Tahun 2024 tentang Badan Gizi Nasional* beserta peraturan pelaksananya.\n\nDi Kota Cimahi, SPPG dikelola oleh yayasan-yayasan mitra yang bertanggung jawab atas penyiapan dan distribusi makanan bergizi ke sekolah dan posyandu di wilayahnya.\n\n📍 Nama yayasan pengelola tiap SPPG bisa Wargi lihat di menu *SPPG* — pilih kelurahan, lalu pilih SPPG-nya.\n\n💡 Untuk informasi kemitraan, silakan hubungi SPPG terdekat atau sampaikan lewat menu *Pengaduan*.',
  'nav_mb',
)

list('sp_kel', {
  body: '🍱 *Satuan Pelayanan Pemenuhan Gizi (SPPG) Kota Cimahi*\n\nSilakan pilih *Kelurahan* untuk melihat SPPG yang melayani wilayah tersebut:',
  buttonText: 'Pilih Kelurahan',
  sectionTitle: 'Kelurahan',
  rows: [
    { id: 'sk_cibeber', title: 'Kelurahan Cibeber', description: '5 SPPG', to: 'sp_cibeber' },
    { id: 'sk_leuwigajah', title: 'Kelurahan Leuwigajah', description: '1 SPPG', to: 'sp_leuwigajah_txt' },
    { id: 'sk_utama', title: 'Kelurahan Utama', description: '2 SPPG', to: 'sp_utama' },
    { id: 'sk_melong', title: 'Kelurahan Melong', description: '4 SPPG', to: 'sp_melong' },
    { id: 'sk_cibeureum', title: 'Kelurahan Cibeureum', description: '4 SPPG', to: 'sp_cibeureum' },
    { id: 'sk_baros', title: 'Kelurahan Baros', description: '2 SPPG', to: 'sp_baros' },
    { id: 'sk_karangmekar', title: 'Kelurahan Karangmekar', description: '3 SPPG', to: 'sp_karangmekar' },
    { id: 'sk_setiamanah', title: 'Kelurahan Setiamanah', description: '1 SPPG', to: 'sp_setiamanah_txt' },
    { id: 'sk_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_sp', 'sp_kel')
text('sp_leuwigajah_txt', T(133), 'nav_sp')
text('sp_setiamanah_txt', T(154), 'nav_sp')

list('sp_cibeber', {
  body: '🍱 *SPPG di Kelurahan Cibeber, Cimahi Selatan*\n\nSilakan pilih *SPPG* untuk melihat alamat, yayasan pengelola, dan penerima manfaatnya:',
  buttonText: 'Pilih SPPG',
  sectionTitle: 'SPPG Cibeber',
  rows: [
    { id: 'spcb_1', title: 'SPPG Cibeber', to: 'spcb_1_txt' },
    { id: 'spcb_2', title: 'SPPG Cibeber 2', to: 'spcb_2_txt' },
    { id: 'spcb_3', title: 'SPPG Fausta Mulyasari', to: 'spcb_3_txt' },
    { id: 'spcb_4', title: 'SPPG Cibeber 4', to: 'spcb_4_txt' },
    { id: 'spcb_5', title: 'SPPG Cibeber 5', to: 'spcb_5_txt' },
    { id: 'spcb_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_spcb', 'sp_cibeber')
text('spcb_1_txt', T(128), 'nav_spcb')
text('spcb_2_txt', T(129), 'nav_spcb')
text('spcb_3_txt', T(130), 'nav_spcb')
text('spcb_4_txt', T(131), 'nav_spcb')
text('spcb_5_txt', T(132), 'nav_spcb')

list('sp_utama', {
  body: '🍱 *SPPG di Kelurahan Utama, Cimahi Selatan*\n\nSilakan pilih *SPPG* untuk melihat detailnya:',
  buttonText: 'Pilih SPPG',
  sectionTitle: 'SPPG Utama',
  rows: [
    { id: 'spu_1', title: 'SPPG Utama 1', to: 'spu_1_txt' },
    { id: 'spu_2', title: 'SPPG Utama 2', to: 'spu_2_txt' },
    { id: 'spu_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_spu', 'sp_utama')
text('spu_1_txt', T(135), 'nav_spu')
text('spu_2_txt', T(136), 'nav_spu')

list('sp_melong', {
  body: '🍱 *SPPG di Kelurahan Melong, Cimahi Selatan*\n\nSilakan pilih *SPPG* untuk melihat detailnya:',
  buttonText: 'Pilih SPPG',
  sectionTitle: 'SPPG Melong',
  rows: [
    { id: 'spm_1', title: 'SPPG Melong', to: 'spm_1_txt' },
    { id: 'spm_2', title: 'SPPG Melong 2', to: 'spm_2_txt' },
    { id: 'spm_3', title: 'SPPG Melong 3', to: 'spm_3_txt' },
    { id: 'spm_4', title: 'SPPG Melong 4', to: 'spm_4_txt' },
    { id: 'spm_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_spm', 'sp_melong')
text('spm_1_txt', T(138), 'nav_spm')
text('spm_2_txt', T(139), 'nav_spm')
text('spm_3_txt', T(140), 'nav_spm')
text('spm_4_txt', T(141), 'nav_spm')

list('sp_cibeureum', {
  body: '🍱 *SPPG di Kelurahan Cibeureum, Cimahi Selatan*\n\nSilakan pilih *SPPG* untuk melihat detailnya:',
  buttonText: 'Pilih SPPG',
  sectionTitle: 'SPPG Cibeureum',
  rows: [
    { id: 'spcr_1', title: 'SPPG Cibeureum', to: 'spcr_1_txt' },
    { id: 'spcr_2', title: 'SPPG Cibeureum 2', to: 'spcr_2_txt' },
    { id: 'spcr_3', title: 'SPPG Cibeureum 3', to: 'spcr_3_txt' },
    { id: 'spcr_4', title: 'SPPG Cibeureum 4', to: 'spcr_4_txt' },
    { id: 'spcr_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_spcr', 'sp_cibeureum')
text('spcr_1_txt', T(143), 'nav_spcr')
text('spcr_2_txt', T(144), 'nav_spcr')
text('spcr_3_txt', T(145), 'nav_spcr')
text('spcr_4_txt', T(146), 'nav_spcr')

list('sp_baros', {
  body: '🍱 *SPPG di Kelurahan Baros, Cimahi Tengah*\n\nSilakan pilih *SPPG* untuk melihat detailnya:',
  buttonText: 'Pilih SPPG',
  sectionTitle: 'SPPG Baros',
  rows: [
    { id: 'spb_1', title: 'SPPG Baros', to: 'spb_1_txt' },
    { id: 'spb_2', title: 'SPPG Baros 02', to: 'spb_2_txt' },
    { id: 'spb_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_spb', 'sp_baros')
text('spb_1_txt', T(148), 'nav_spb')
text('spb_2_txt', T(149), 'nav_spb')

list('sp_karangmekar', {
  body: '🍱 *SPPG di Kelurahan Karangmekar, Cimahi Tengah*\n\nSilakan pilih *SPPG* untuk melihat detailnya:',
  buttonText: 'Pilih SPPG',
  sectionTitle: 'SPPG Karangmekar',
  rows: [
    { id: 'spk_1', title: 'SPPG Karangmekar', to: 'spk_1_txt' },
    { id: 'spk_2', title: 'SPPG Karangmekar 2', to: 'spk_2_txt' },
    { id: 'spk_3', title: 'SPPG Karangmekar 3', to: 'spk_3_txt' },
    { id: 'spk_menu_utama', title: 'Menu Utama', to: 'menu' },
  ],
})
nav('nav_spk', 'sp_karangmekar')
text('spk_1_txt', T(151), 'nav_spk')
text('spk_2_txt', T(152), 'nav_spk')
text('spk_3_txt', T(153), 'nav_spk')

// ------------------------------------------------------------------ layout

/**
 * Lays the graph out as a tree so the editor canvas stays readable.
 *
 * Only forward edges become parentage: "Kembali" and "Menu Utama" point back at
 * ancestors, and treating those as parentage would collapse the whole graph
 * onto the main menu.
 */
function layout() {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const parent = new Map<string, string>()
  const children = new Map<string, string[]>()

  const queue = ['trigger']
  const seen = new Set(queue)
  while (queue.length) {
    const id = queue.shift()!
    for (const e of edges) {
      if (e.source !== id || seen.has(e.target)) continue
      // A node pinned elsewhere is attached after the walk, not here.
      const pinned = layoutParent.get(e.target)
      if (pinned && pinned !== id && byId.has(pinned)) continue
      seen.add(e.target)
      parent.set(e.target, id)
      queue.push(e.target)
    }
  }
  for (const [child, pinned] of layoutParent) {
    if (byId.has(child) && byId.has(pinned)) parent.set(child, pinned)
  }
  for (const [child, p] of parent) children.set(p, [...(children.get(p) ?? []), child])

  // The router branch only leads into the tree, never out of it, so it is
  // placed by hand beside the main trigger below.
  const sideRoots = new Set(['trigger_ai', 'arahkan'])
  const orphans = nodes.filter((n) => n.id !== 'trigger' && !sideRoots.has(n.id) && !parent.has(n.id))
  if (orphans.length) {
    throw new Error(`Node tanpa induk di layout: ${orphans.map((n) => n.id).join(', ')}`)
  }

  const COL = 420
  const ROW = 300
  let nextLeafColumn = 0

  function place(id: string, depth: number): number {
    const node = byId.get(id)!
    const kids = children.get(id) ?? []
    node.position.y = depth * ROW
    if (kids.length === 0) {
      node.position.x = nextLeafColumn * COL
      nextLeafColumn += 1
    } else {
      const xs = kids.map((k) => place(k, depth + 1))
      node.position.x = (Math.min(...xs) + Math.max(...xs)) / 2
    }
    return node.position.x
  }

  place('trigger', 0)

  const trigger = byId.get('trigger')!.position
  byId.get('trigger_ai')!.position = { x: trigger.x - COL, y: 0 }
  byId.get('arahkan')!.position = { x: trigger.x - COL, y: ROW }
}

layout()

// ---------------------------------------------------------------- write out

const graph: FlowGraph = { nodes, edges }

// A duplicate id silently drops whichever node came first, taking its branch
// with it - cheaper to catch here than to hunt in the canvas.
const dupes = nodes.map((n) => n.id).filter((id, i, all) => all.indexOf(id) !== i)
if (dupes.length) throw new Error(`Node id dobel: ${[...new Set(dupes)].join(', ')}`)

const issues = validateFlow(graph)
// A missing router endpoint is the admin's to pick, not a broken graph: the
// draft is still written, and publishing refuses until it is chosen.
const errors = issues.filter((i) => i.severity === 'error' && !(i.nodeId === 'arahkan' && !router && /pilih AI/.test(i.message)))

console.log(`${nodes.length} node, ${edges.length} koneksi`)
for (const i of issues) console.log(`  [${i.severity}] ${i.nodeId ?? '-'}: ${i.message}`)

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

console.log(
  router
    ? `\nArahkan AI memakai "${router.name}".`
    : '\nBelum ada AI jenis "Arahkan ke menu": tambahkan di halaman AI, lalu pilih di node Arahkan AI.',
)
console.log('Draf tersimpan. Buka editor untuk meninjau, lalu terbitkan sendiri.')
await prisma.$disconnect()
