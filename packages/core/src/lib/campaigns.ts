import { prisma, MessageStatus, RecipientStatus, type Prisma } from '@wa/db'
import type { CampaignAudience } from '../campaign.js'
import { logger } from './logger.js'

const log = logger.child({ module: 'campaigns' })

/**
 * The contacts a broadcast goes to.
 *
 * Opted-out contacts are left in, deliberately: the runner records them as
 * SKIPPED so the report shows who was held back and why, instead of the
 * audience silently shrinking.
 */
export function audienceWhere(orgId: string, a: CampaignAudience): Prisma.ContactWhereInput {
  return {
    orgId,
    ...(a.tags.length ? (a.match === 'all' ? { tags: { hasEvery: a.tags } } : { tags: { hasSome: a.tags } }) : {}),
  }
}

const OUTCOME: Partial<Record<MessageStatus, RecipientStatus>> = {
  [MessageStatus.SENT]: RecipientStatus.SENT,
  [MessageStatus.DELIVERED]: RecipientStatus.DELIVERED,
  [MessageStatus.READ]: RecipientStatus.READ,
  [MessageStatus.FAILED]: RecipientStatus.FAILED,
}

/**
 * Mirrors a broadcast message's status onto its recipient row.
 *
 * Called wherever a message's status changes - the send worker and Meta's
 * status callbacks - so the campaign report follows delivery without the
 * runner having to poll messages. A no-op for messages that are not part of
 * a broadcast. Never throws: a report lagging must not fail a send.
 */
export async function recordRecipientOutcome(
  message: { id: string; sentBy: string | null; status: MessageStatus; errorMessage?: string | null; sentAt?: Date | null },
) {
  if (!message.sentBy?.startsWith('campaign:')) return
  const status = OUTCOME[message.status]
  if (!status) return

  try {
    await prisma.campaignRecipient.updateMany({
      where: { messageId: message.id },
      data: {
        status,
        ...(status === RecipientStatus.FAILED ? { error: message.errorMessage ?? 'gagal' } : { error: null }),
        ...(message.sentAt ? { sentAt: message.sentAt } : {}),
      },
    })
  } catch (err) {
    log.error({ messageId: message.id, err: err instanceof Error ? err.message : String(err) }, 'update penerima broadcast gagal')
  }
}
