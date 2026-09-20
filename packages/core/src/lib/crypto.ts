import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHmac } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

let cachedKey: Buffer | null = null

function key(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY is not set')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}`)
  }
  cachedKey = buf
  return buf
}

/** Encrypts a channel access token for storage. Output is base64(iv|tag|ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64')
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64')
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('ciphertext is truncated')
  const decipher = createDecipheriv(ALGO, key(), buf.subarray(0, IV_LEN))
  decipher.setAuthTag(buf.subarray(IV_LEN, IV_LEN + TAG_LEN))
  return Buffer.concat([decipher.update(buf.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString('utf8')
}

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the raw request body.
 *
 * Must run on the exact bytes Meta sent. Re-serializing the parsed JSON changes
 * key order and whitespace, and the digest stops matching.
 */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = Buffer.from(header.slice('sha256='.length), 'hex')
  const actual = createHmac('sha256', appSecret).update(rawBody).digest()
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}
