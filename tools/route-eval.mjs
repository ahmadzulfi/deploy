#!/usr/bin/env node
/**
 * Runs the router test set against any POST /route endpoint and shows where
 * to set Arahkan AI's minimum score.
 *
 * A wrong jump is worse than no jump: the contact gets the wrong office's
 * information, while "no jump" only costs the menu messages we have today.
 * So the table below counts the two separately for every candidate minimum.
 *
 *   node tools/route-eval.mjs --url http://localhost:4010/route
 *   node tools/route-eval.mjs --url https://ai.contoh.id/route --token rahasia
 *   node tools/route-eval.mjs --url http://localhost:8080/route --clarify-min 0.5
 *
 * With --clarify-min the table also shows what "Kalau ragu, tanya balik"
 * would do: a question that does not jump gets a list of the candidates
 * scoring at least that much, picked the same way the engine picks them.
 *
 * Defaults read the Cimahi menu and the 23 questions from
 * "Claude outputs/router-ai/"; --destinations and --tests take other files.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const arg = (f, d) => {
  const i = process.argv.indexOf(`--${f}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const url = arg('url')
if (!url) {
  console.error('Pakai --url, mis. --url http://localhost:4010/route')
  process.exit(1)
}
const here = new URL('../Claude outputs/router-ai/', import.meta.url)
const destinations = JSON.parse(readFileSync(arg('destinations', new URL('cimahi-destinations.json', here)), 'utf8'))
const tests = JSON.parse(readFileSync(arg('tests', new URL('route-test-set.json', here)), 'utf8'))
const token = arg('token')
const timeoutMs = Number(arg('timeout', 8)) * 1000
const clarifyMin = arg('clarify-min') === undefined ? null : Number(arg('clarify-min'))

// Same fields and order the worker sends, so the hash matches a real call.
const wire = destinations.map(({ id, path, description, content }) => ({ id, path, description, content }))
const catalogHash = createHash('sha256').update(JSON.stringify(wire)).digest('hex')
const pathOf = new Map(wire.map((d) => [d.id, d.path]))

const results = []
for (const t of tests) {
  const started = Date.now()
  let answer
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ question: t.question, catalog_hash: catalogHash, destinations: wire }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    answer = res.ok ? await res.json() : { error: `HTTP ${res.status}` }
  } catch (err) {
    answer = { error: err.name === 'TimeoutError' ? `lewat ${timeoutMs / 1000} detik` : err.message }
  }
  results.push({ ...t, answer, ms: Date.now() - started })
}

const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : '-')
console.log(`\n${wire.length} tujuan, ${tests.length} soal, ${url}\n`)
for (const r of results) {
  const got = r.answer.error ? `ERROR ${r.answer.error}` : (r.answer.destination_id ?? 'null')
  const right = r.expected === null ? r.answer.destination_id === null : r.expected.includes(r.answer.destination_id)
  console.log(
    `${right ? 'benar' : 'SALAH'}  ${fmt(r.answer.score)}  ${String(r.ms).padStart(5)} ms  ${r.question}\n` +
      `        dapat: ${got}${pathOf.has(got) ? ` (${pathOf.get(got)})` : ''}\n` +
      `        harus: ${r.expected === null ? 'null' : r.expected.join(' / ')}`,
  )
}

/** What the engine would offer as "Maksud Anda", in its order and limit. */
function offered(a) {
  if (clarifyMin === null || a.error) return []
  const ranked = [...(a.destination_id ? [{ id: a.destination_id, score: a.score }] : []), ...(a.candidates ?? [])]
  const out = []
  for (const c of ranked) {
    if (out.length === 3) break
    if (c.score >= clarifyMin && pathOf.has(c.id) && !out.includes(c.id)) out.push(c.id)
  }
  return out
}

console.log(
  clarifyMin === null
    ? '\nSkor minimal  benar  salah arah  jatuh ke menu'
    : `\nTanya balik untuk kandidat dengan skor >= ${clarifyMin}\n` +
        'Skor minimal  benar  salah arah  tanya balik (ada yg benar)  tanya balik (tidak ada)  jatuh ke menu',
)
for (let min = 0.3; min <= 0.951; min += 0.05) {
  let right = 0
  let wrong = 0
  let menu = 0
  let askedRight = 0
  let askedWrong = 0
  for (const r of results) {
    const a = r.answer
    const jumped = !a.error && a.destination_id && a.score >= min && pathOf.has(a.destination_id) ? a.destination_id : null
    const options = jumped ? [] : offered(a)
    if (options.length) {
      if (r.expected !== null && options.some((id) => r.expected.includes(id))) askedRight++
      else askedWrong++
    } else if (r.expected === null ? jumped === null : r.expected.includes(jumped)) right++
    else if (jumped) wrong++
    else menu++
  }
  const cols = [min.toFixed(2).padStart(11), String(right).padStart(5), String(wrong).padStart(10)]
  if (clarifyMin !== null) cols.push(String(askedRight).padStart(24), String(askedWrong).padStart(23))
  cols.push(String(menu).padStart(13))
  console.log(cols.join('  '))
}
console.log('\nPilih skor minimal terkecil yang "salah arah"-nya 0, lalu isi di node Arahkan AI.')
