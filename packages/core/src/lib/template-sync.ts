import { prisma, Prisma, TemplateStatus } from '@wa/db'
import { credentialsFor, providerFor } from '../providers/index.js'
import { logger } from './logger.js'

const log = logger.child({ module: 'template-sync' })

export interface TemplateSyncResult {
  wabaId: string
  /** Name of the channel whose token was used, for the error message. */
  channelName: string
  count?: number
  error?: string
}

const KNOWN_STATUS = new Set<string>(Object.values(TemplateStatus))

/**
 * Mirrors every WABA's templates into the Template table.
 *
 * Templates belong to a WABA, not to a phone number, so each WABA is fetched
 * once through whichever of its channels comes first. One WABA failing (a
 * revoked token, say) does not stop the others; each gets its own result.
 */
export async function syncTemplates(orgId: string): Promise<TemplateSyncResult[]> {
  const channels = await prisma.channel.findMany({
    where: { orgId, wabaId: { not: null }, accessTokenEnc: { not: null } },
    orderBy: { createdAt: 'asc' },
  })

  const byWaba = new Map<string, (typeof channels)[number]>()
  for (const c of channels) if (!byWaba.has(c.wabaId!)) byWaba.set(c.wabaId!, c)

  const results: TemplateSyncResult[] = []

  for (const [wabaId, channel] of byWaba) {
    try {
      const remote = await providerFor(channel).listTemplates(credentialsFor(channel))
      const now = new Date()

      await prisma.$transaction([
        ...remote.map((t) => {
          const data = {
            channelId: channel.id,
            category: t.category,
            components: t.components as Prisma.InputJsonValue,
            metaTemplateId: t.metaTemplateId,
            metaStatus: KNOWN_STATUS.has(t.status) ? (t.status as TemplateStatus) : TemplateStatus.PENDING,
            rejectionReason: t.rejectionReason && t.rejectionReason !== 'NONE' ? t.rejectionReason : null,
            syncedAt: now,
          }
          return prisma.template.upsert({
            where: { wabaId_name_language: { wabaId, name: t.name, language: t.language } },
            create: { wabaId, name: t.name, language: t.language, ...data },
            update: data,
          })
        }),
        // Deleted on Meta's side. A campaign still pointing at one keeps the
        // row for its history, disabled so nobody picks it again.
        prisma.template.deleteMany({
          where: { wabaId, syncedAt: { not: now }, campaigns: { none: {} } },
        }),
        prisma.template.updateMany({
          where: { wabaId, syncedAt: { not: now } },
          data: { metaStatus: TemplateStatus.DISABLED },
        }),
      ])

      results.push({ wabaId, channelName: channel.name, count: remote.length })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.warn({ wabaId, channelId: channel.id, err: error }, 'template sync failed')
      results.push({ wabaId, channelName: channel.name, error })
    }
  }

  return results
}

/** Every org, one after another. Used by the worker's periodic sync. */
export async function syncAllTemplates(): Promise<TemplateSyncResult[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true } })
  const out: TemplateSyncResult[] = []
  for (const o of orgs) out.push(...(await syncTemplates(o.id)))
  return out
}

/**
 * Meta's review outcomes, mapped onto our statuses.
 *
 * FLAGGED is a quality warning, not a block: the template still sends until
 * Meta escalates it to PAUSED, so it keeps whatever status it had.
 */
const TEMPLATE_EVENT_STATUS: Record<string, TemplateStatus | undefined> = {
  APPROVED: TemplateStatus.APPROVED,
  REINSTATED: TemplateStatus.APPROVED,
  REJECTED: TemplateStatus.REJECTED,
  PENDING: TemplateStatus.PENDING,
  PAUSED: TemplateStatus.PAUSED,
  DISABLED: TemplateStatus.DISABLED,
  PENDING_DELETION: TemplateStatus.DISABLED,
  DELETED: TemplateStatus.DISABLED,
}

/**
 * Applies one `message_template_status_update` webhook.
 *
 * Without this a template approved by Meta stays PENDING here until someone
 * presses sync, and one Meta pauses keeps being offered to agents and
 * broadcasts that will all fail.
 *
 * @returns what happened, for the caller to log
 */
export async function applyTemplateStatusUpdate(change: unknown): Promise<string> {
  const value = (change as { value?: Record<string, unknown> } | null)?.value ?? {}
  const event = String(value.event ?? '').toUpperCase()
  const metaTemplateId = value.message_template_id != null ? String(value.message_template_id) : ''
  if (!metaTemplateId) return 'tanpa message_template_id'

  const status = TEMPLATE_EVENT_STATUS[event]
  if (!status) return `event ${event || '(kosong)'} diabaikan`

  const reason = typeof value.reason === 'string' && value.reason !== 'NONE' ? value.reason : null
  const { count } = await prisma.template.updateMany({
    where: { metaTemplateId },
    data: {
      metaStatus: status,
      // Only a rejection carries a reason worth keeping; an approval clears the old one.
      rejectionReason: status === TemplateStatus.REJECTED ? reason : null,
    },
  })

  // Not mirrored yet (created on Meta after our last sync): the next
  // periodic sync brings it in with its full definition.
  return count ? `template ${metaTemplateId} -> ${status}` : `template ${metaTemplateId} belum tersinkron`
}
