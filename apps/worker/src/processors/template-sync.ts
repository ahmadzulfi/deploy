import { logger, syncAllTemplates } from '@wa/core'

const log = logger.child({ worker: 'template-sync' })

/**
 * The backstop behind Meta's template status webhook.
 *
 * The webhook already moves a template between APPROVED, PAUSED and the rest
 * as it happens. This catches what the webhook cannot: templates created or
 * deleted on Meta's side, and any status change whose webhook was missed.
 */
const EVERY_MS = 6 * 3600_000

/** Gives the rest of the worker a moment to come up before the first call to Meta. */
const FIRST_RUN_MS = 60_000

export function startTemplateSync() {
  const run = async () => {
    try {
      const results = await syncAllTemplates()
      const failed = results.filter((r) => r.error)
      log.info(
        { wabas: results.length, templates: results.reduce((n, r) => n + (r.count ?? 0), 0), failed: failed.length },
        'sinkron template berkala',
      )
      for (const f of failed) log.warn({ wabaId: f.wabaId, channel: f.channelName, err: f.error }, 'sinkron template gagal')
    } catch (err) {
      log.error(err, 'sinkron template berkala gagal')
    }
  }

  const first = setTimeout(() => void run(), FIRST_RUN_MS)
  const timer = setInterval(() => void run(), EVERY_MS)
  first.unref()
  timer.unref()

  return {
    stop: () => {
      clearTimeout(first)
      clearInterval(timer)
    },
  }
}
