import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_PRESETS,
  buildAiRequest,
  checkAiConfig,
  readPath,
  renderAnswer,
  type AiEndpointConfig,
} from '../src/ai.ts'

const base: AiEndpointConfig = {
  method: 'POST',
  url: 'https://api.contoh.id/chat',
  headers: 'Authorization: Bearer rahasia',
  body: '{"q": "{{pertanyaan}}", "user": "{{nomor}}"}',
  answerTemplate: '{{answer}}',
  timeoutSeconds: 20,
}

describe('building the request', () => {
  test('percent-encodes the question into the URL', () => {
    const req = buildAiRequest({ ...base, method: 'GET', url: 'https://x.id/s?q={{pertanyaan}}' }, { pertanyaan: 'ktp & kk' })
    assert.equal(req.url, 'https://x.id/s?q=ktp%20%26%20kk')
    assert.equal(req.body, undefined)
  })

  test('JSON-escapes the question into the body, so quotes cannot break it', () => {
    const req = buildAiRequest(base, { pertanyaan: 'kata "rusak"\nbaris dua', nomor: '62812' })
    assert.deepEqual(JSON.parse(req.body!), { q: 'kata "rusak"\nbaris dua', user: '62812' })
    assert.equal(req.headers['Content-Type'], 'application/json')
    assert.equal(req.headers.Authorization, 'Bearer rahasia')
  })

  test('a contact name cannot start a second header line', () => {
    const req = buildAiRequest({ ...base, headers: 'X-User: {{nama}}' }, { pertanyaan: 'a', nama: 'Budi\r\nX-Evil: 1' })
    assert.equal(req.headers['X-User'], 'Budi X-Evil: 1')
    assert.equal(req.headers['X-Evil'], undefined)
  })
})

describe('reading the answer', () => {
  test('walks objects and array indexes', () => {
    const data = { choices: [{ message: { content: 'Halo!' } }] }
    assert.equal(readPath(data, 'choices.0.message.content'), 'Halo!')
    assert.equal(renderAnswer('{{choices.0.message.content}}', data), 'Halo!')
  })

  test('a filter finds the text block even when thinking comes first', () => {
    // The shape Claude returns: thinking (and possibly fallback) blocks before the text.
    const data = {
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'Bawa KK dan surat polisi.' },
      ],
    }
    assert.equal(renderAnswer('{{content[type=text].text}}', data), 'Bawa KK dan surat polisi.')
  })

  test('several matching blocks are joined', () => {
    const data = { content: [{ type: 'text', text: 'Satu.' }, { type: 'fallback' }, { type: 'text', text: 'Dua.' }] }
    assert.equal(renderAnswer('{{content[type=text].text}}', data), 'Satu.\n\nDua.')
  })

  test('the embed-search preset reads its two fields', () => {
    const data = { feedback: { short_description: 'Singkat.', long_summary: 'Panjang.' } }
    const preset = AI_PRESETS.find((p) => p.id === 'embed-search')!
    assert.equal(renderAnswer(preset.config.answerTemplate, data), 'Singkat.\n\nPanjang.')
  })

  test('a missing field renders empty, which the caller treats as a failure', () => {
    assert.equal(renderAnswer('{{choices.0.message.content}}', { error: 'x' }), '')
  })

  test('a blank template passes a plain-text response through', () => {
    assert.equal(renderAnswer('', '  Halo  '), 'Halo')
    assert.equal(renderAnswer('', { a: 1 }), '')
  })
})

describe('checking the form', () => {
  test('every preset except the empty custom one is valid as shipped', () => {
    for (const p of AI_PRESETS.filter((p) => p.id !== 'custom')) {
      assert.equal(checkAiConfig(p.config), null, p.id)
    }
  })

  test('the question must be sent somewhere', () => {
    assert.match(checkAiConfig({ ...base, body: '{"q": "halo"}' })!, /pertanyaan/)
  })

  test('an unknown placeholder is named', () => {
    assert.match(checkAiConfig({ ...base, body: '{"q": "{{pertanyaan}}", "k": "{{kota}}"}' })!, /\{\{kota\}\}/)
  })

  test('a body that is not JSON is refused', () => {
    assert.match(checkAiConfig({ ...base, body: '{"q": {{pertanyaan}}}' })!, /JSON/)
  })

  test('the timeout stays within what a flow node waits', () => {
    assert.match(checkAiConfig({ ...base, timeoutSeconds: 90 })!, /30/)
  })
})
