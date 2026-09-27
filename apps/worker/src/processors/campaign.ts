import { Worker } from 'bullmq'
import {
  prisma,
  Prisma,
  CampaignStatus,
  Direction,
  MessageStatus,
  OptInStatus,
  RecipientStatus,
  TemplateStatus,
} from '@wa/db'
import {
  audienceWhere,
  buildTemplateComponents,
  campaignAudienceSchema,
  campaignVariableMapSchema,
  logger,
  renderCampaignValues,
  renderTemplate,
  type OutboundMessage,
} from '@wa/core'
import { campaignQueue, enqueueSend, QUEUE, workerOptions, type SendJob } from '@wa/core/queues'

const log = logger.child({ worker: 'campaign' })

/**
 * Broadcast runner.
 *
 * A running campaign advances in ticks: each tick queues the next slice of
 * recipients - sized so the campaign keeps to its throttlePerMin - then
 * schedules the one after. Sends go through the ordinary per-channel outbound
 * queue, so a broadcast never jumps ahead of live replies on the same number.
 *
 * The dashboard never touches a queue. It flips the campaign's status, and
 * the poller here notices within a few seconds - the same outbox pattern the
 * outgoing webhooks use.
 */

const TICK_MS = 10_000

/**
 * A tick that ran more recently than this owns the campaign; any other tick
 * chain stands down and ends. Just under TICK_MS, since BullMQ never fires a
 * delayed job early, so the owner always clears it and an intruder never does.
 */
const LEASE_MS = TICK_MS * 0.9

/** How often the poller looks for campaigns to start or revive. */
const POLL_MS = 5_000

/** A running campaign quieter than this has lost its tick chain; the poller re-arms it. */
const STALL_MS = TICK_MS * 3

const CREATE_CHUNK = 1_000

export interface TickDeps {
  enqueue: (job: SendJob) => Promise<unknown>
}

/** @returns when to tick next, or null to end this chain */
export async function runCampaignTick(
  campaignId: string,
  now = new Date(),
  deps: TickDeps = { enqueue: enqueueSend },
): Promise<Date | null> {
  const c = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { template: true, channel: true },
  })
  if (!c) return null
  if (c.status === CampaignStatus.SCHEDULED && c.scheduleAt && c.scheduleAt > now) return c.scheduleAt
  if (c.status !== CampaignStatus.SCHEDULED && c.status !== CampaignStatus.RUNNING) return null

  // Claim this tick. Losing the race means another chain owns the campaign.
  const { count: claimed } = await prisma.campaign.updateMany({
    where: {
      id: c.id,
      status: { in: [CampaignStatus.SCHEDULED, CampaignStatus.RUNNING] },
      OR: [{ lastTickAt: null }, { lastTickAt: { lte: new Date(now.getTime() - LEASE_MS) } }],
    },
    data: { lastTickAt: now },
  })
  if (!claimed) return null

  if (c.template.metaStatus !== TemplateStatus.APPROVED) {
    await stopWith(c.id, `Template ${c.template.name} berstatus ${c.template.metaStatus}; broadcast dijeda.`)
    return null
  }
  if (c.channel.sendingPaused) {
    // Nothing would go out anyway, and queuing more only deepens the backlog.
    return new Date(now.getTime() + TICK_MS)
  }

  if (!c.startedAt) {
    await materialize(c, now)
  }

  const quota = Math.max(1, Math.round((c.throttlePerMin * TICK_MS) / 60_000))
  const batch = await prisma.campaignRecipient.findMany({
    where: { campaignId: c.id, status: RecipientStatus.PENDING, messageId: null },
    take: quota,
    include: { contact: true },
    orderBy: { id: 'asc' },
  })

  const map = campaignVariableMapSchema.parse(c.variableMap ?? {})
  const channelCtx = { name: c.channel.name, displayPhone: c.channel.displayPhone }

  for (const r of batch) {
    await queueOne(c, r, map, channelCtx, deps)
  }

  const done = await tally(c.id)
  if (done) {
    await prisma.campaign.update({
      where: { id: c.id },
      data: { status: CampaignStatus.COMPLETED, completedAt: new Date() },
    })
    log.info({ campaignId: c.id }, 'broadcast selesai')
    return null
  }
  return new Date(now.getTime() + TICK_MS)
}

type LoadedCampaign = Prisma.CampaignGetPayload<{ include: { template: true; channel: true } }>

/**
 * Turns the audience rule into recipient rows, once.
 *
 * Taken as a snapshot at start: a contact tagged after the campaign began is
 * not pulled in halfway, so the report describes one fixed list.
 */
async function materialize(c: LoadedCampaign, now: Date) {
  const audience = campaignAudienceSchema.parse(c.audienceQuery ?? {})
  const contacts = await prisma.contact.findMany({
    where: audienceWhere(c.orgId, audience),
    select: { id: true, optInStatus: true },
  })

  const rows = contacts.map((ct) => {
    // Someone who replied STOP is held back from every broadcast, whatever
    // the template's category: a bulk send they did not ask for is exactly
    // what they opted out of.
    const skip =
      ct.optInStatus === OptInStatus.OPTED_OUT
        ? 'berhenti berlangganan'
        : audience.optInOnly && ct.optInStatus !== OptInStatus.OPTED_IN
          ? 'belum opt-in'
          : null
    return {
      campaignId: c.id,
      contactId: ct.id,
      status: skip ? RecipientStatus.SKIPPED : RecipientStatus.PENDING,
      error: skip,
    }
  })

  // skipDuplicates makes a re-run after a crash mid-way harmless.
  for (let i = 0; i < rows.length; i += CREATE_CHUNK) {
    await prisma.campaignRecipient.createMany({ data: rows.slice(i, i + CREATE_CHUNK), skipDuplicates: true })
  }

  await prisma.campaign.update({
    where: { id: c.id },
    data: { status: CampaignStatus.RUNNING, startedAt: now, error: null },
  })
  log.info({ campaignId: c.id, recipients: rows.length }, 'broadcast mulai')
}

async function queueOne(
  c: LoadedCampaign,
  r: Prisma.CampaignRecipientGetPayload<{ include: { contact: true } }>,
  map: Record<string, string>,
  channel: { name: string; displayPhone: string | null },
  deps: TickDeps,
) {
  const fail = (error: string) =>
    prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: RecipientStatus.FAILED, error } })

  const { values, empty } = renderCampaignValues(
    map,
    {
      name: r.contact.name,
      waId: r.contact.waId,
      attributes: (r.contact.attributes ?? {}) as Record<string, unknown>,
      tags: r.contact.tags,
    },
    channel,
  )
  if (empty.length) return fail(`isian kosong untuk kontak ini: ${empty.join(', ')}`)
  if (values['header.media'] !== undefined && !/^https:\/\//i.test(values['header.media'])) {
    return fail('link media header harus https')
  }

  const message: OutboundMessage = {
    kind: 'template',
    name: c.template.name,
    language: c.template.language,
    components: buildTemplateComponents(c.template.components, values),
  }
  const sentBy = `campaign:${c.id}`

  const conversation = await prisma.conversation.upsert({
    where: { channelId_contactId: { channelId: c.channelId, contactId: r.contactId } },
    create: { channelId: c.channelId, contactId: r.contactId },
    update: {},
  })

  // Row first, linked to the recipient in the same transaction, then the job:
  // the send worker and Meta's status callbacks find the recipient through
  // this message, and a recipient must never point at a row that does not exist.
  const row = await prisma.$transaction(async (tx) => {
    const m = await tx.message.create({
      data: {
        conversationId: conversation.id,
        direction: Direction.OUT,
        type: 'template',
        payload: { ...message, preview: renderTemplate(c.template.components, values) } as unknown as Prisma.InputJsonValue,
        status: MessageStatus.QUEUED,
        sentBy,
      },
    })
    await tx.campaignRecipient.update({ where: { id: r.id }, data: { messageId: m.id } })
    return m
  })

  try {
    await deps.enqueue({
      channelId: c.channelId,
      conversationId: conversation.id,
      to: r.contact.waId,
      message,
      sentBy,
      messageId: row.id,
    })
  } catch (err) {
    const error = `gagal masuk antrean: ${err instanceof Error ? err.message : String(err)}`
    await prisma.message.update({ where: { id: row.id }, data: { status: MessageStatus.FAILED, errorMessage: error } })
    await fail(error)
  }
}

/**
 * Rewrites the campaign's cached counts.
 * @returns true once no recipient is waiting to be queued or on a send outcome
 */
async function tally(campaignId: string): Promise<boolean> {
  const groups = await prisma.campaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  })
  const n = (s: RecipientStatus) => groups.find((g) => g.status === s)?._count._all ?? 0
  const total = groups.reduce((sum, g) => sum + g._count._all, 0)

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      totalCount: total,
      sentCount: n(RecipientStatus.SENT) + n(RecipientStatus.DELIVERED) + n(RecipientStatus.READ),
      failedCount: n(RecipientStatus.FAILED),
      skippedCount: n(RecipientStatus.SKIPPED),
    },
  })
  // Delivered/read arrive later and keep updating the rows; they do not hold
  // the campaign open. Only a recipient still PENDING does.
  return n(RecipientStatus.PENDING) === 0
}

async function stopWith(campaignId: string, error: string) {
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: CampaignStatus.PAUSED, error } })
  log.warn({ campaignId, error }, 'broadcast dihentikan')
}

/**
 * Finds campaigns that should be ticking and are not: just started or
 * resumed from the dashboard, due from a schedule, or orphaned by a lost job
 * or a worker restart. The lease in runCampaignTick makes re-arming a live
 * campaign harmless, so this errs toward re-arming.
 */
export async function armDueCampaigns(now = new Date()) {
  const stale = new Date(now.getTime() - STALL_MS)
  const due = await prisma.campaign.findMany({
    where: {
      OR: [
        { status: CampaignStatus.RUNNING, OR: [{ lastTickAt: null }, { lastTickAt: { lt: stale } }] },
        {
          status: CampaignStatus.SCHEDULED,
          OR: [{ scheduleAt: null }, { scheduleAt: { lte: now } }],
          AND: [{ OR: [{ lastTickAt: null }, { lastTickAt: { lt: stale } }] }],
        },
      ],
    },
    select: { id: true },
  })
  for (const c of due) await campaignQueue().add('tick', { campaignId: c.id })
  return due.length
}

export function startCampaignWorker() {
  const worker = new Worker<{ campaignId: string }>(
    QUEUE.campaign,
    async (job) => {
      const next = await runCampaignTick(job.data.campaignId)
      if (next) {
        await campaignQueue().add('tick', job.data, { delay: Math.max(0, next.getTime() - Date.now()) })
      }
    },
    workerOptions({ concurrency: 2 }),
  )
  worker.on('failed', (job, err) => log.error({ campaignId: job?.data.campaignId, err: err.message }, 'tick broadcast gagal'))

  let running = false
  const poll = async () => {
    if (running) return
    running = true
    try {
      await armDueCampaigns()
    } catch (err) {
      log.error(err, 'poll broadcast gagal')
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void poll(), POLL_MS)
  timer.unref()
  void poll()

  return {
    close: async () => {
      clearInterval(timer)
      await worker.close()
    },
  }
}
