#!/usr/bin/env node
/**
 * A stand-in for apps/ai-knowledge, for trying the Basis Pengetahuan page and
 * the Tanya AI node locally - no Postgres, no Gemini quota, nothing written
 * to the shared database.
 *
 * Same routes and response shapes as the Go service, but documents live in
 * memory (reset on restart) and similarity is plain word overlap. Like the
 * real one, a repeated question is answered from cache, and any document
 * change empties the cache. Do not judge answer quality with it.
 *
 *   node tools/fake-knowledge.mjs                 # http://localhost:4020
 *   node tools/fake-knowledge.mjs --port 4021 --key rahasia
 *   node tools/fake-knowledge.mjs --fail          # every call answers 500
 *   node tools/fake-knowledge.mjs --slow 3        # writes and searches wait 3 s
 */
import { createServer } from 'node:http'

const arg = (f, d) => {
  const i = process.argv.indexOf(`--${f}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const port = Number(arg('port', 4020))
const key = arg('key')
const fail = process.argv.includes('--fail')
const slowMs = Number(arg('slow', 0)) * 1000

/** The service's own refusal line: below this nothing is said to match. */
const GUARDRAIL = 0.45

let nextId = 1
const docs = new Map()
const cache = new Map()

function add(category, title, content) {
  const doc = { id: nextId++, category, title, content, created_at: new Date().toISOString() }
  docs.set(doc.id, doc)
  return doc
}

add(
  'Kependudukan',
  'Contoh: KTP elektronik hilang',
  'Bawa surat keterangan kehilangan dari kepolisian dan fotokopi Kartu Keluarga ke kantor kecamatan. ' +
    'Perekaman ulang tidak diperlukan bila data biometrik sudah ada. Tidak dipungut biaya.',
)
add(
  'Kependudukan',
  'Contoh: Akta kelahiran anak',
  'Siapkan surat keterangan lahir dari bidan atau rumah sakit, Kartu Keluarga, KTP kedua orang tua, dan buku nikah. ' +
    'Ajukan ke Disdukcapil paling lambat 60 hari setelah kelahiran.',
)
add(
  'Perizinan',
  'Contoh: Nomor Induk Berusaha (NIB)',
  'NIB diajukan sendiri lewat portal OSS dengan NIK dan alamat usaha. Usaha mikro tidak dipungut biaya.',
)

const words = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)

/** Share of the question's words that the document also uses. */
function similarity(question, d) {
  const asked = [...new Set(words(question))]
  if (!asked.length) return 0
  const known = new Set(words(`${d.category} ${d.title} ${d.content}`))
  return asked.filter((w) => known.has(w)).length / asked.length
}

const pct = (n) => `${(n * 100).toFixed(2)}%`

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const error = (res, status, message) => send(res, status, { status: 'error', message })

function authorized(req) {
  if (!key) return true
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
  return [req.headers['x-internal-api-key'], req.headers['x-api-key'], bearer].includes(key)
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve(null)
      }
    })
  })
}

function search(query, limit) {
  const hit = cache.get(query.trim().toLowerCase())
  if (hit) return { ...hit, source: 'cache', cache_hit: true, cache_similarity: '100.00%', matched_history: hit.query, query }

  const ranked = [...docs.values()]
    .map((d) => ({ d, s: Number(similarity(query, d).toFixed(4)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
  const best = ranked[0]
  const found = best && best.s >= GUARDRAIL

  const answer = {
    status: 'success',
    source: 'generated',
    cache_hit: false,
    query,
    feedback: {
      related_service: found ? best.d.title : 'Tidak Ditemukan',
      category: found ? best.d.category : '',
      short_description: found
        ? `(tiruan) Untuk ${best.d.title.toLowerCase()}, ringkasnya sebagai berikut.`
        : '(tiruan) Maaf, informasi itu belum tersedia di SOP resmi.',
      long_summary: found ? best.d.content : '',
      best_similarity: best?.s ?? 0,
      best_similarity_percentage: pct(best?.s ?? 0),
    },
    matched_sources: ranked.map(({ d, s }) => ({
      id: d.id,
      category: d.category,
      title: d.title,
      similarity: s,
      similarity_percentage: pct(s),
    })),
  }
  cache.set(query.trim().toLowerCase(), answer)
  return answer
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const log = (what) => console.log(`${new Date().toLocaleTimeString('id-ID')}  ${req.method} ${path}  ${what}`)

  if (path === '/') return send(res, 200, { status: 'success', message: 'Layanan pengetahuan tiruan' })
  if (!authorized(req)) {
    log('401')
    return error(res, 401, 'Akses ditolak: X-Internal-API-Key tidak valid atau tidak disertakan')
  }
  if (fail) return error(res, 500, 'gagal (--fail)')

  const wait = () => new Promise((r) => setTimeout(r, slowMs))
  const idMatch = path.match(/^\/documents\/(\d+)$/)
  const id = idMatch ? Number(idMatch[1]) : null

  if (path === '/documents/search' && (req.method === 'GET' || req.method === 'POST')) {
    const body = req.method === 'POST' ? await readJson(req) : null
    if (req.method === 'POST' && !body) return error(res, 400, 'Invalid JSON body')
    const query = String((body ? body.query : url.searchParams.get('q') ?? url.searchParams.get('query')) ?? '').trim()
    if (!query) return error(res, 400, 'Query pertanyaan atau keluhan tidak boleh kosong')
    const limit = Number(body?.limit ?? url.searchParams.get('limit')) || 3
    await wait()
    const answer = search(query, limit)
    log(`"${query}" -> ${answer.feedback.related_service} (${answer.feedback.best_similarity}, ${answer.source})`)
    return send(res, 200, answer)
  }

  if (path === '/documents' && req.method === 'GET') {
    const limit = Number(url.searchParams.get('limit')) || 50
    const offset = Number(url.searchParams.get('offset')) || 0
    const all = [...docs.values()].sort((a, b) => a.id - b.id)
    log(`${all.length} dokumen`)
    return send(res, 200, {
      status: 'success',
      table: 'docs-gemini-001',
      total: all.length,
      limit,
      offset,
      data: all.slice(offset, offset + limit),
    })
  }

  if ((path === '/documents' && req.method === 'POST') || (id && req.method === 'PUT')) {
    const body = await readJson(req)
    if (!body) return error(res, 400, 'Invalid JSON body')
    const category = String(body.category ?? '').trim() || 'Umum'
    const title = String(body.title ?? '').trim()
    const content = String(body.content ?? '').trim()
    if (!title || !content) return error(res, 400, "Field 'title' dan 'content' tidak boleh kosong")
    if (id && !docs.has(id)) return error(res, 404, `document with id ${id} not found`)
    await wait()
    const doc = id ? Object.assign(docs.get(id), { category, title, content }) : add(category, title, content)
    cache.clear()
    log(`#${doc.id} ${title}`)
    return send(res, id ? 200 : 201, {
      status: 'success',
      message: id ? 'Dokumen diperbarui (tiruan)' : 'Dokumen disimpan (tiruan)',
      data: { id: doc.id, category, title, content, embedding_dimension: 768 },
    })
  }

  if (id && req.method === 'GET') {
    const doc = docs.get(id)
    return doc ? send(res, 200, { status: 'success', data: doc }) : error(res, 404, `Dokumen dengan ID ${id} tidak ditemukan`)
  }

  if (id && req.method === 'DELETE') {
    if (!docs.delete(id)) return error(res, 404, `document with id ${id} not found`)
    cache.clear()
    log(`#${id} dihapus`)
    return send(res, 200, { status: 'success', message: `Dokumen dengan ID ${id} berhasil dihapus` })
  }

  return error(res, 404, 'rute tidak dikenal')
}).listen(port, () => {
  console.log(`Layanan pengetahuan tiruan di http://localhost:${port}${key ? ' (butuh key)' : ''}`)
  console.log(`Isi AI_KNOWLEDGE_URL="http://localhost:${port}" di .env, lalu buka /knowledge di dashboard.`)
})
