import { prisma } from '@wa/db'
import { env, logger } from '@wa/core'
import { closeQueues } from '@wa/core/queues'
import { startInboundWorker } from './processors/inbound.js'
import { startOutboundWorkers } from './processors/outbound.js'
import { startFlowWorker } from './processors/flow.js'
import { startSessionSweeper } from './processors/sweeper.js'
import { startWebhookDispatcher } from './processors/webhooks.js'
import { startCampaignWorker } from './processors/campaign.js'
import { startTemplateSync } from './processors/template-sync.js'

async function main() {
  env() // fail fast on missing config

  const inbound = startInboundWorker()
  const flow = startFlowWorker()
  const outbound = await startOutboundWorkers()
  const sweeper = startSessionSweeper()
  const webhooks = startWebhookDispatcher()
  const campaigns = startCampaignWorker()
  const templates = startTemplateSync()
  logger.info('worker service ready')

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'draining workers')
    sweeper.stop()
    webhooks.stop()
    templates.stop()
    await Promise.all([inbound.close(), flow.close(), campaigns.close(), ...outbound.map((w) => w.close())])
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
