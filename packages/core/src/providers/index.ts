import { prisma, type Channel } from '@wa/db'
import { decrypt } from '../lib/crypto.js'
import { env } from '../lib/env.js'
import { cloudApiProvider } from './cloud-api.js'
import { ProviderError, type ChannelCredentials, type ChannelProvider } from './types.js'

export * from './types.js'
export * from './limits.js'
export { normalizeCloudApiWebhook } from './normalize.js'
export { CloudApiProvider, cloudApiProvider, RE_ENGAGEMENT_CODE } from './cloud-api.js'

const registry: Record<string, ChannelProvider> = {
  CLOUD_API: cloudApiProvider,
  // BAILEYS: baileysProvider,  <- fase lanjutan
}

export function providerFor(channel: Pick<Channel, 'provider'>): ChannelProvider {
  const p = registry[channel.provider]
  if (!p) throw new ProviderError(`no provider registered for "${channel.provider}"`, 'NO_PROVIDER')
  return p
}

/**
 * Decrypts a channel's token into a short-lived credentials object.
 *
 * Kept as a function rather than cached state so the plaintext token lives only
 * for the duration of one call.
 */
export function credentialsFor(channel: Channel): ChannelCredentials {
  if (!channel.accessTokenEnc) throw new ProviderError(`channel ${channel.id} has no access token`, 'NO_TOKEN')
  if (!channel.phoneNumberId) throw new ProviderError(`channel ${channel.id} has no phoneNumberId`, 'NO_PHONE_ID')
  if (!channel.wabaId) throw new ProviderError(`channel ${channel.id} has no wabaId`, 'NO_WABA_ID')

  return {
    channelId: channel.id,
    phoneNumberId: channel.phoneNumberId,
    wabaId: channel.wabaId,
    accessToken: decrypt(channel.accessTokenEnc),
    graphVersion: env().META_GRAPH_VERSION,
  }
}

/** Resolves the inbound webhook's phone_number_id back to our channel row. */
export async function channelByPhoneNumberId(phoneNumberId: string) {
  return prisma.channel.findUnique({ where: { phoneNumberId } })
}
