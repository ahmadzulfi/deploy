import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateButtons,
  validateList,
  isWindowOpen,
  windowExpiryFrom,
  WhatsAppValidationError,
} from '../src/providers/limits.ts'

const rows = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, title: `${prefix.toUpperCase()}${i}` }))

function rejects(fn: () => void, match: RegExp) {
  assert.throws(fn, (e: unknown) => e instanceof WhatsAppValidationError && match.test((e as Error).message))
}

describe('reply buttons', () => {
  test('accepts the maximum of three', () => {
    validateButtons('halo', [
      { id: 'a', title: 'Ya' },
      { id: 'b', title: 'Tidak' },
      { id: 'c', title: 'CS' },
    ])
  })

  test('rejects a fourth button', () => {
    rejects(
      () => validateButtons('halo', [...rows('b', 4)].map((r) => ({ id: r.id, title: r.title }))),
      /4 buttons, WhatsApp allows 3/,
    )
  })

  test('rejects a title over 20 chars', () => {
    rejects(() => validateButtons('halo', [{ id: 'a', title: 'x'.repeat(21) }]), /max 20/)
  })

  test('rejects duplicate ids, which would make the reply ambiguous', () => {
    rejects(
      () => validateButtons('halo', [{ id: 'a', title: '1' }, { id: 'a', title: '2' }]),
      /duplicate button id/,
    )
  })

  test('rejects a body over 1024 chars', () => {
    rejects(() => validateButtons('x'.repeat(1025), [{ id: 'a', title: 'Ya' }]), /body is 1025 chars/)
  })
})

describe('list messages', () => {
  test('accepts 10 rows spread across sections', () => {
    validateList('pilih', 'Menu', [
      { title: 'A', rows: rows('a', 5) },
      { title: 'B', rows: rows('b', 5) },
    ])
  })

  test('counts rows across all sections, not per section', () => {
    rejects(
      () =>
        validateList('pilih', 'Menu', [
          { title: 'A', rows: rows('a', 6) },
          { title: 'B', rows: rows('b', 5) },
        ]),
      /11 rows across all sections, max 10/,
    )
  })

  test('rejects a row description over 72 chars', () => {
    rejects(
      () => validateList('pilih', 'Menu', [{ title: 'A', rows: [{ id: 'a', title: 'A', description: 'x'.repeat(73) }] }]),
      /row\.description/,
    )
  })
})

describe('customer service window', () => {
  test('expires 24h after the inbound message', () => {
    assert.equal(
      windowExpiryFrom(new Date('2026-09-20T10:00:00Z')).toISOString(),
      '2026-09-21T10:00:00.000Z',
    )
  })

  test('is open a minute before expiry', () => {
    assert.equal(isWindowOpen(new Date('2026-09-20T12:00:00Z'), new Date('2026-09-20T11:59:00Z')), true)
  })

  test('is closed a minute after expiry', () => {
    assert.equal(isWindowOpen(new Date('2026-09-20T12:00:00Z'), new Date('2026-09-20T12:01:00Z')), false)
  })

  test('is closed when no inbound message has ever arrived', () => {
    assert.equal(isWindowOpen(null), false)
  })
})
