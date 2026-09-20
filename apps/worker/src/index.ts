import { prisma } from '@wa/db'
import { closeQueues, env, logger } from '@wa/core'
import { startInboundWorker } from './processors/inbound.js'
import { startOutboundWorkers } from './processors/outbound.js'

async function main() {
  env() // fail fast on missing config

  const inbound = startInboundWorker()
  const outbound = await startOutboundWorkers()
  logger.info('worker service ready')

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'draining workers')
    await Promise.all([inbound.close(), ...outbound.map((w) => w.close())])
    await closeQueues()
    await prisma.$disconnect()
    process.exit(0)
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal))
  }
}

main().catch((err) => {
  logger.fatal(err, 'worker service failed to start')
  process.exit(1)
})
