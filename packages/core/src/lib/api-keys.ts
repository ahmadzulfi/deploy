import { createHash } from 'node:crypto'
import { prisma } from '@wa/db'

/** Permissions an API key can carry. The dashboard offers exactly these. */
export const API_SCOPES = [
  'messages:send',
  'messages:read',
  'contacts:read',
  'contacts:write',
  'flows:trigger',
  'flows:read',
  'templates:read',
] as const

export type ApiScope = (typeof API_SCOPES)[number]

export interface ApiPrincipal {
  keyId: string
  orgId: string
  name: string
  scopes: string[]
  /** Channels the key is limited to; empty means every channel in the org. */
  channelIds: string[]
}

/** Whether a key may act on this channel. */
export function canUseChannel(p: Pick<ApiPrincipal, 'channelIds'>, channelId: string) {
  return p.channelIds.length === 0 || p.channelIds.includes(channelId)
}

export const hashApiKey = (plain: string) => createHash('sha256').update(plain).digest('hex')

/** Skip rewriting lastUsedAt on every call; minute precision is plenty. */
const TOUCH_EVERY_MS = 60_000

/**
 * Resolves a presented key to its org and scopes, or null.
 *
 * Only the hash is stored, so lookup is by hash; a revoked key is treated
 * exactly like an unknown one so the response does not reveal which it was.
 */
export async function authenticateApiKey(plain: string): Promise<ApiPrincipal | null> {
  if (!plain.startsWith('wa_')) return null

  const key = await prisma.apiKey.findUnique({ where: { hashedKey: hashApiKey(plain) } })
  if (!key || key.revokedAt) return null

  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
  }

  return { keyId: key.id, orgId: key.orgId, name: key.name, scopes: key.scopes, channelIds: key.channelIds }
}
