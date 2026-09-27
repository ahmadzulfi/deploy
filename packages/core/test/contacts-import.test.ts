import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { contactRowsFromCsv, normalizeWaId, parseCsv } from '../src/contacts-import.ts'

describe('normalizeWaId', () => {
  it('turns local Indonesian numbers into 62…', () => {
    assert.equal(normalizeWaId('0812-3456-7890'), '6281234567890')
    assert.equal(normalizeWaId('+62 812 3456 7890'), '6281234567890')
    assert.equal(normalizeWaId('6281234567890'), '6281234567890')
    assert.equal(normalizeWaId('81234567890'), '6281234567890')
  })

  it('keeps foreign numbers and strips the 00 prefix', () => {
    assert.equal(normalizeWaId('+1 (415) 555-0100'), '14155550100')
    assert.equal(normalizeWaId('0060123456789'), '60123456789')
    assert.equal(normalizeWaId('8613800138000'), '8613800138000')
  })

  it('rejects what cannot be a phone number', () => {
    assert.equal(normalizeWaId(''), null)
    assert.equal(normalizeWaId('12345'), null)
    assert.equal(normalizeWaId('abc'), null)
    assert.equal(normalizeWaId('1234567890123456'), null)
  })
})

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿nama,nomor\r\n"Budi, S.Kom","0812"\r\n"Kata ""halo""",0813\r\n')
    assert.deepEqual(rows, [
      ['nama', 'nomor'],
      ['Budi, S.Kom', '0812'],
      ['Kata "halo"', '0813'],
    ])
  })

  it('detects semicolon-separated files', () => {
    assert.deepEqual(parseCsv('nama;nomor\nBudi;0812\n'), [
      ['nama', 'nomor'],
      ['Budi', '0812'],
    ])
  })

  it('skips blank lines', () => {
    assert.deepEqual(parseCsv('a\n\n\nb\n'), [['a'], ['b']])
  })
})

describe('contactRowsFromCsv', () => {
  it('maps header aliases, tags and attributes', () => {
    const { rows, errors } = contactRowsFromCsv('Nama,No HP,Grup,kelurahan\nBudi,0812345678,rw-05;pelapor,Cibabat\n')
    assert.deepEqual(errors, [])
    assert.deepEqual(rows, [
      { waId: '62812345678', name: 'Budi', tags: ['rw-05', 'pelapor'], attributes: { kelurahan: 'Cibabat' } },
    ])
  })

  it('reports bad rows by spreadsheet line and keeps the good ones', () => {
    const { rows, errors } = contactRowsFromCsv('phone,name\n0812345678,A\n,B\nxyz,C\n0813456789,D\n')
    assert.equal(rows.length, 2)
    assert.deepEqual(
      errors.map((e) => e.line),
      [3, 4],
    )
  })

  it('merges a number listed twice', () => {
    const { rows } = contactRowsFromCsv('phone,name,tags\n0812345678,,a\n+62812345678,Budi,b\n')
    assert.deepEqual(rows, [{ waId: '62812345678', name: 'Budi', tags: ['a', 'b'], attributes: {} }])
  })

  it('refuses a file without a phone column', () => {
    const { rows, errors } = contactRowsFromCsv('nama,alamat\nBudi,Cimahi\n')
    assert.equal(rows.length, 0)
    assert.equal(errors[0]?.line, 1)
  })

  it('skips attribute columns with unusable names', () => {
    const { rows, errors } = contactRowsFromCsv('phone,1abc,kota\n0812345678,x,Cimahi\n')
    assert.deepEqual(rows[0]?.attributes, { kota: 'Cimahi' })
    assert.equal(errors.length, 1)
  })
})
