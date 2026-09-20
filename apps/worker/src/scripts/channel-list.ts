import { prisma } from '@wa/db'
import { loadEnvFile } from '@wa/core'

async function main() {
  loadEnvFile()
  const channels = await prisma.channel.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      displayPhone: true,
      phoneNumberId: true,
      status: true,
      qualityRating: true,
      messagingTier: true,
      sendingPaused: true,
    },
  })

  if (!channels.length) {
    console.log('No channels yet. Register one with "pnpm channel:add".')
    return
  }

  for (const c of channels) {
    const flag = c.sendingPaused ? '  [PAUSED]' : ''
    console.log(`${c.id}  ${c.name}${flag}`)
    console.log(`    ${c.displayPhone ?? '-'}  phoneNumberId=${c.phoneNumberId}`)
    console.log(`    ${c.status}  quality=${c.qualityRating}  tier=${c.messagingTier}\n`)
  }
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
