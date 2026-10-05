#!/usr/bin/env node
/**
 * A stand-in for the POST /route service, for local end-to-end runs.
 *
 * Speaks the same contract as the real router - question, catalog_hash and
 * destinations in; destination_id, score and candidates out - but scores by
 * plain word overlap, so the whole Arahkan AI path can be exercised before
 * the real embedding service exists. Do not judge accuracy with it.
 *
 *   node tools/fake-route.mjs                 # http://localhost:4010/route
 *   node tools/fake-route.mjs --port 4011 --token rahasia --min 0.5
 *   node tools/fake-route.mjs --fail          # every call answers 500
 *   node tools/fake-route.mjs --slow 12       # every call waits 12 s
 */
import { createServer } from 'node:http'

const arg = (f, d) => {
  const i = process.argv.indexOf(`--${f}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const port = Number(arg('port', 4010))
const token = arg('token')
const min = Number(arg('min', 0.5))
const fail = process.argv.includes('--fail')
const slowMs = Number(arg('slow', 0)) * 1000

const words = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)

/** Share of the question's words found in what the destination says about itself. */
function score(question, d) {
  const asked = [...new Set(words(question))]
  if (!asked.length) return 0
  const known = new Set(words(`${d.path} ${d.description} ${d.content}`))
  return asked.filter((w) => known.has(w)).length / asked.length
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/route') return send(res, 404, { error: 'pakai POST /route' })
  if (token && req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: 'token salah' })

  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return send(res, 400, { error: 'body bukan JSON' })
    }
    const { question, destinations } = body
    if (typeof question !== 'string' || !question.trim()) return send(res, 400, { error: 'question kosong' })
    if (!Array.isArray(destinations) || !destinations.length) return send(res, 400, { error: 'destinations kosong' })

    const ranked = destinations
      .map((d) => ({ id: d.id, score: Number(score(question, d).toFixed(3)) }))
      .sort((a, b) => b.score - a.score)
    const best = ranked[0]
    const answer = {
      destination_id: best.score >= min ? best.id : null,
      score: best.score,
      candidates: ranked.slice(0, 3),
    }

    console.log(
      `${new Date().toLocaleTimeString('id-ID')}  "${question}" -> ${answer.destination_id ?? 'null'} (${best.score}) ` +
        `[${destinations.length} tujuan, hash ${String(body.catalog_hash).slice(0, 8)}]`,
    )
    setTimeout(() => (fail ? send(res, 500, { error: 'gagal (--fail)' }) : send(res, 200, answer)), slowMs)
  })
}).listen(port, () => {
  console.log(`Router tiruan di http://localhost:${port}/route${token ? ' (butuh token)' : ''}`)
  console.log('Isi URL ini di halaman AI, jenis "Arahkan ke menu".')
})
