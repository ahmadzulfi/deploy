import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { LABEL_COLORS, checkLabel, cleanLabelName, isLabelColor } from '../src/labels.ts'

describe('label names', () => {
  test('trims and collapses whitespace', () => {
    assert.equal(cleanLabelName('  Butuh   tindak\tlanjut \n'), 'Butuh tindak lanjut')
  })
})

describe('checking a label', () => {
  const ok = { name: 'Komplain', description: '', color: 'red' }

  test('accepts a plain label', () => {
    assert.equal(checkLabel(ok), null)
  })

  test('needs a name', () => {
    assert.match(checkLabel({ ...ok, name: '' })!, /wajib/)
  })

  test('caps the name and description', () => {
    assert.match(checkLabel({ ...ok, name: 'x'.repeat(41) })!, /40/)
    assert.equal(checkLabel({ ...ok, name: 'x'.repeat(40) }), null)
    assert.match(checkLabel({ ...ok, description: 'x'.repeat(201) })!, /200/)
  })

  test('only takes palette colours, never a raw hex', () => {
    assert.match(checkLabel({ ...ok, color: '#ff0000' })!, /warna/)
    assert.equal(isLabelColor('purple'), true)
    assert.equal(isLabelColor('constructor'), false)
    for (const c of LABEL_COLORS) assert.equal(checkLabel({ ...ok, color: c }), null)
  })
})
