import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkPublicUrl, isPrivateAddress, isTrustedInternalUrl } from '../src/lib/public-url.ts'

describe('isPrivateAddress', () => {
  it('refuses the IPv4 ranges only reachable from inside', () => {
    for (const ip of [
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.10',
      '127.0.0.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      assert.equal(isPrivateAddress(ip), true, ip)
    }
  })

  it('lets public IPv4 through, including the edges of private ranges', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.0', '100.63.255.255', '100.128.0.0']) {
      assert.equal(isPrivateAddress(ip), false, ip)
    }
  })

  it('refuses private IPv6, and IPv4 smuggled inside IPv6', () => {
    for (const ip of [
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1', // same, hex form
      '::ffff:10.0.0.1',
      '64:ff9b::a9fe:a9fe', // NAT64 to 169.254.169.254
      '2001:db8::1',
    ]) {
      assert.equal(isPrivateAddress(ip), true, ip)
    }
  })

  it('lets public IPv6 through', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
      assert.equal(isPrivateAddress(ip), false, ip)
    }
  })

  it('treats garbage as private rather than guessing', () => {
    assert.equal(isPrivateAddress('not-an-ip'), true)
    assert.equal(isPrivateAddress('1:2:3'), true)
  })
})

describe('checkPublicUrl', () => {
  const prod = { allowLocalhost: false }
  const dev = { allowLocalhost: true }

  it('refuses plain http and private literals', async () => {
    assert.match((await checkPublicUrl('http://example.com/h', prod))!, /https/)
    assert.match((await checkPublicUrl('https://10.0.0.5/h', prod))!, /internal/)
    assert.match((await checkPublicUrl('https://[::1]/h', prod))!, /internal/)
    assert.match((await checkPublicUrl('https://169.254.169.254/latest', prod))!, /internal/)
  })

  it('refuses credentials in the URL and malformed URLs', async () => {
    assert.match((await checkPublicUrl('https://u:p@8.8.8.8/h', prod))!, /username/)
    assert.equal(await checkPublicUrl('nope', prod), 'URL tidak valid.')
  })

  it('refuses a hostname that resolves to loopback', async () => {
    assert.match((await checkPublicUrl('https://localhost/h', prod))!, /internal/)
  })

  it('allows localhost over http only when development allows it', async () => {
    assert.equal(await checkPublicUrl('http://localhost:4000/h', dev), null)
    assert.equal(await checkPublicUrl('http://127.0.0.1:4000/h', dev), null)
    assert.match((await checkPublicUrl('http://localhost:4000/h', prod))!, /https/)
  })

  it('accepts a public IP literal over https', async () => {
    assert.equal(await checkPublicUrl('https://8.8.8.8/h', prod), null)
  })
})

describe('isTrustedInternalUrl', () => {
  const list = 'localhost:8080, AI-Knowledge:8080,router.lan'
  const trusted = (u: string) => isTrustedInternalUrl(new URL(u), list)

  it('trusts exactly the listed host:port pairs', () => {
    assert.equal(trusted('http://localhost:8080/route'), true)
    assert.equal(trusted('http://ai-knowledge:8080/route'), true)
    assert.equal(trusted('http://localhost:5435/'), false)
    assert.equal(trusted('http://127.0.0.1:8080/route'), false)
  })

  it('reads a host without a port as the default port only', () => {
    assert.equal(trusted('http://router.lan/route'), true)
    assert.equal(trusted('https://router.lan/route'), true)
    assert.equal(trusted('http://router.lan:6379/'), false)
  })

  it('refuses credentials and other protocols', () => {
    assert.equal(trusted('http://u:p@localhost:8080/route'), false)
    assert.equal(trusted('ftp://localhost:8080/'), false)
  })

  it('trusts nothing when the list is empty', () => {
    assert.equal(isTrustedInternalUrl(new URL('http://localhost:8080/route'), ''), false)
  })
})
