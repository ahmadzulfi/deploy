import { prisma, type WabaConnection } from '@wa/db'
import { decrypt } from './crypto.js'
import { metaSettings } from './settings.js'

/**
 * Resolves the credentials a webhook needs to verify one payload.
 *
 * Each connection carries the secret of the Meta App its WABA lives under, so
 * the receiver must know which connection a request belongs to *before* it can
 * check the signature - hence the connection id in the callback path. Without
 * it the receiver would have to try every stored secret, which turns a failed
 * verification into an oracle for how many apps are connected.
 */

const TTL_MS = 30_000
const cache = new Map<string, { value: ConnectionSecrets; at: number }>()

export interface ConnectionSecrets {
  id: string
  orgId: string
  name: string
  appSecret: string
  verifyToken: string
}

export async function connectionSecrets(connectionId: string): Promise<ConnectionSecrets | null> {
  const hit = cache.get(connectionId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const row = await prisma.wabaConnection.findUnique({ where: { id: connectionId } })
  if (!row) return null

  const value: ConnectionSecrets = {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    appSecret: decrypt(row.appSecretEnc),
    verifyToken: row.verifyToken,
  }

  cache.set(connectionId, { value, at: Date.now() })
  return value
}

export function clearConnectionCache(connectionId?: string) {
  if (connectionId) cache.delete(connectionId)
  else cache.clear()
}

/** Decrypted Graph API credentials for a connection. */
export function connectionCredentials(row: WabaConnection) {
  return {
    wabaId: row.wabaId,
    accessToken: decrypt(row.accessTokenEnc),
    graphVersion: row.graphVersion,
  }
}

/**
 * The org-wide settings, used by the legacy single-app webhook path.
 * Kept so an install configured before connections existed keeps receiving.
 */
export { metaSettings }
