import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { callRoute, routeCatalogHash } from '../src/lib/ai-call.ts'
import { checkRouteConfig } from '../src/ai.ts'
import type { RouteDestination } from '../src/flow/catalog.ts'

const destinations: RouteDestination[] = [
  { id: 'mp_polres', path: 'Layanan Publik › Polres Cimahi (SKCK)', description: 'SKCK', content: 'Info SKCK', target: 'mp_polres_txt' },
  { id: 'mp_imigrasi', path: 'Layanan Publik › Imigrasi (Paspor)', description: '', content: 'Info paspor', target: 'mp_imigrasi_txt' },
]

/** What the fake router answers next, and what it last received. */
let reply: { status: number; body: string; delayMs?: number } = { status: 200, body: '{}' }
let received: { headers: IncomingMessage['headers']; body: Record<string, unknown> } | null = null
let server: Server
let url: string

before(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      received = { headers: req.headers, body: JSON.parse(raw || '{}') }
      setTimeout(() => {
        res.writeHead(reply.status, { 'Content-Type': 'application/json' })
        res.end(reply.body)
      }, reply.delayMs ?? 0)
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/route`
})

after(() => server.close())

const cfg = () => ({ url, headers: 'Authorization: Bearer rahasia', timeoutSeconds: 2 })

describe('callRoute', () => {
  test('sends the contract body: question, hash, and the menu without our node ids', async () => {
    reply = { status: 200, body: JSON.stringify({ destination_id: 'mp_polres', score: 0.81 }) }

    await callRoute(cfg(), { question: 'cara bikin skck', destinations })

    const body = received!.body
    assert.equal(body.question, 'cara bikin skck')
    assert.deepEqual(body.destinations, destinations.map(({ target: _t, ...rest }) => rest))
    assert.equal(body.catalog_hash, routeCatalogHash(body.destinations as never))
    assert.match(String(body.catalog_hash), /^[0-9a-f]{64}$/)
    assert.equal(received!.headers.authorization, 'Bearer rahasia')
    assert.equal(received!.headers['content-type'], 'application/json')
  })

  test('sends approved examples, and leaves the field out when there are none', async () => {
    reply = { status: 200, body: JSON.stringify({ destination_id: 'mp_polres', score: 0.93 }) }
    const examples = [{ destination_id: 'mp_polres', question: 'bikin skck dimana' }]

    await callRoute(cfg(), { question: 'bikin skck dmn', destinations, examples })
    assert.deepEqual(received!.body.examples, examples)
    // The hash is the menu's alone, so approving an example does not change it.
    assert.equal(received!.body.catalog_hash, routeCatalogHash(received!.body.destinations as never))

    await callRoute(cfg(), { question: 'skck', destinations, examples: [] })
    assert.equal('examples' in received!.body, false)
  })

  test('reads the pick, score and candidates', async () => {
    reply = {
      status: 200,
      body: JSON.stringify({ destination_id: 'mp_polres', score: 0.81, candidates: [{ id: 'mp_polres', score: 0.81 }] }),
    }

    const r = await callRoute(cfg(), { question: 'skck', destinations })

    assert.ok(r.ok)
    assert.equal(r.destinationId, 'mp_polres')
    assert.equal(r.score, 0.81)
    assert.deepEqual(r.candidates, [{ id: 'mp_polres', score: 0.81 }])
  })

  test('a null pick is a valid answer, and candidates may be left out', async () => {
    reply = { status: 200, body: JSON.stringify({ destination_id: null, score: 0.31 }) }

    const r = await callRoute(cfg(), { question: 'terima kasih', destinations })

    assert.ok(r.ok)
    assert.equal(r.destinationId, null)
    assert.deepEqual(r.candidates, [])
  })

  test('an answer that breaks the contract is a failure', async () => {
    reply = { status: 200, body: JSON.stringify({ id: 'mp_polres', similarity: 0.8 }) }

    const r = await callRoute(cfg(), { question: 'skck', destinations })

    assert.ok(!r.ok)
    assert.match(r.error, /tidak sesuai kontrak/)
  })

  test('a non-2xx status is a failure that carries the body', async () => {
    reply = { status: 401, body: JSON.stringify({ error: 'token salah' }) }

    const r = await callRoute(cfg(), { question: 'skck', destinations })

    assert.ok(!r.ok)
    assert.equal(r.status, 401)
    assert.match(r.error, /HTTP 401.*token salah/)
  })

  test('a router slower than the timeout is a failure', async () => {
    reply = { status: 200, body: JSON.stringify({ destination_id: 'mp_polres', score: 0.9 }), delayMs: 1500 }

    const r = await callRoute({ ...cfg(), timeoutSeconds: 1 }, { question: 'skck', destinations })

    assert.ok(!r.ok)
    assert.match(r.error, /1 detik/)
  })
})

describe('checkRouteConfig', () => {
  test('accepts a plain https URL', () => {
    assert.equal(checkRouteConfig({ url: 'https://ai.contoh.id/route', timeoutSeconds: 8 }), null)
  })

  test('refuses placeholders: the question goes in the body', () => {
    assert.match(checkRouteConfig({ url: 'https://ai.contoh.id/route?q={{pertanyaan}}', timeoutSeconds: 8 })!, /body/)
  })

  test('refuses a timeout outside 1 to 30 seconds', () => {
    assert.match(checkRouteConfig({ url: 'https://ai.contoh.id/route', timeoutSeconds: 0 })!, /Batas waktu/)
  })
})
