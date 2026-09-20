import { prisma } from '@wa/db'
import { decrypt } from './crypto.js'
import { env } from './env.js'

/**
 * App-level Meta settings, read from the database with the .env value as a
 * fallback.
 *
 * The fallback is what makes moving these into the dashboard safe: an install
 * that has not filled the settings page yet keeps working on its old
 * environment variables, and stops depending on them the moment it does.
 */

export interface MetaSettings {
  appSecret: string
  graphVersion: string
  verifyToken: string
  /** Where each value actually came from, for the settings page to show. */
  source: { appSecret: 'db' | 'env' | 'missing'; verifyToken: 'db' | 'env' | 'missing' }
}

/**
 * Short-lived cache. The webhook resolves these on every inbound request, and
 * a database round trip per message is wasted work - but the window has to
 * stay small so a rotated secret takes effect without a restart.
 */
const TTL_MS = 30_000
let cache: { value: MetaSettings; orgId: string; at: number } | null = null

export async function metaSettings(orgId?: string): Promise<MetaSettings> {
  const org = orgId
    ? await prisma.organization.findUnique({ where: { id: orgId } })
    : await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } })

  if (!org) throw new Error('organization tidak ditemukan')

  if (cache && cache.orgId === org.id && Date.now() - cache.at < TTL_MS) return cache.value

  const fromEnv = safeEnv()

  const appSecret = org.metaAppSecretEnc ? decrypt(org.metaAppSecretEnc) : (fromEnv.appSecret ?? '')
  const verifyToken = org.webhookVerifyToken ?? fromEnv.verifyToken ?? ''

  const value: MetaSettings = {
    appSecret,
    graphVersion: org.metaGraphVersion || fromEnv.graphVersion || 'v21.0',
    verifyToken,
    source: {
      appSecret: org.metaAppSecretEnc ? 'db' : fromEnv.appSecret ? 'env' : 'missing',
      verifyToken: org.webhookVerifyToken ? 'db' : fromEnv.verifyToken ? 'env' : 'missing',
    },
  }

  cache = { value, orgId: org.id, at: Date.now() }
  return value
}

/** Call after writing settings so the next request sees them immediately. */
export function clearMetaSettingsCache() {
  cache = null
}

/**
 * The env vars are optional now, so reading them must not throw when they are
 * absent - that is the normal state once settings live in the database.
 */
function safeEnv() {
  try {
    const e = env()
    return { appSecret: e.META_APP_SECRET, graphVersion: e.META_GRAPH_VERSION, verifyToken: e.WEBHOOK_VERIFY_TOKEN }
  } catch {
    return { appSecret: undefined, graphVersion: undefined, verifyToken: undefined }
  }
}
