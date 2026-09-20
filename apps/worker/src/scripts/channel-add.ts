import { prisma, ChannelStatus, QualityRating } from '@wa/db'
import { cloudApiProvider, encrypt, env } from '@wa/core'

/**
 * Registers one WhatsApp number.
 *
 * Usage:
 *   pnpm channel:add --name "CS Utama" --waba 1234 --phone-id 5678 --token EAAG...
 *
 * Use a System User token, not the temporary one from Graph API Explorer -
 * that expires in 24h and every send starts failing the next morning with an
 * error that does not mention expiry.
 */

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  env()

  const name = arg('name')
  const wabaId = arg('waba')
  const phoneNumberId = arg('phone-id')
  const token = arg('token')

  if (!name || !wabaId || !phoneNumberId || !token) {
    console.error(
      'Usage: pnpm channel:add --name "CS Utama" --waba <WABA_ID> --phone-id <PHONE_NUMBER_ID> --token <SYSTEM_USER_TOKEN>',
    )
    process.exit(1)
  }

  const org =
    (await prisma.organization.findFirst()) ??
    (await prisma.organization.create({ data: { name: 'Internal' } }))

  // Verify the credentials before storing them, so a typo surfaces here rather
  // than as a silent dead channel later.
  const creds = {
    channelId: 'pending',
    phoneNumberId,
    wabaId,
    accessToken: token,
    graphVersion: env().META_GRAPH_VERSION,
  }

  console.log('Checking credentials against the Graph API...')
  const health = await cloudApiProvider.getPhoneNumberHealth(creds)
  console.log(`  number:  ${health.displayPhone} (${health.verifiedName ?? 'unverified'})`)
  console.log(`  quality: ${health.qualityRating}`)
  console.log(`  tier:    ${health.messagingTier}`)

  console.log('Subscribing this Meta App to the WABA webhooks...')
  await cloudApiProvider.subscribeApp(creds)

  const channel = await prisma.channel.upsert({
    where: { phoneNumberId },
    create: {
      orgId: org.id,
      name,
      wabaId,
      phoneNumberId,
      displayPhone: health.displayPhone,
      accessTokenEnc: encrypt(token),
      status: ChannelStatus.CONNECTED,
      qualityRating: (health.qualityRating as QualityRating) ?? QualityRating.UNKNOWN,
      messagingTier: health.messagingTier,
      lastHealthCheck: new Date(),
    },
    update: {
      name,
      wabaId,
      displayPhone: health.displayPhone,
      accessTokenEnc: encrypt(token),
      status: ChannelStatus.CONNECTED,
      qualityRating: (health.qualityRating as QualityRating) ?? QualityRating.UNKNOWN,
      messagingTier: health.messagingTier,
      lastHealthCheck: new Date(),
    },
  })

  console.log(`\nChannel ready: ${channel.name}  id=${channel.id}`)
}

// Disconnect BEFORE exiting. process.exit() inside .catch() runs while
// Prisma is still tearing down its connection pool, and libuv aborts the
// process with a handle assertion instead of reporting the real error.
try {
  await main()
} catch (err) {
  console.error()
  console.error('Failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
