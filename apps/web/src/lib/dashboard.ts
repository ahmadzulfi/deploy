import { prisma, Direction, MessageStatus } from '@wa/db'

/**
 * Everything the home page shows, for one org, one date range and
 * optionally one number. Every figure on the page comes from the same slice,
 * so the numbers always agree with each other.
 *
 * Days are counted in the org's timezone: "today" for an office in Cimahi
 * starts at midnight WIB, not at midnight UTC seven hours later.
 */

export const RANGES = [7, 30, 90] as const
export type RangeDays = (typeof RANGES)[number]

/** "YYYY-MM-DD" of an instant, as a calendar in `tz` shows it. */
function dayKey(d: Date, tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** How far `tz` is ahead of UTC at this instant, in ms. */
function tzOffsetMs(at: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!)
  return asUtc - at.getTime()
}

/** The instant a calendar day begins in `tz`. */
function dayStart(key: string, tz: string) {
  const [y, m, d] = key.split('-').map(Number)
  const guess = new Date(Date.UTC(y!, m! - 1, d!))
  return new Date(guess.getTime() - tzOffsetMs(guess, tz))
}

/** `n` day keys ending today, oldest first. */
function lastDays(n: number, tz: string, now: Date) {
  const today = dayKey(now, tz)
  const [y, m, d] = today.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.UTC(y!, m! - 1, d! - (n - 1 - i)))
    return t.toISOString().slice(0, 10)
  })
}

export interface DashboardData {
  days: string[]
  inbound: number[]
  outbound: number[]
  newConversations: number[]
  totals: {
    inbound: number
    outbound: number
    newConversations: number
    deliveryRate: number | null
  }
  previous: {
    inbound: number
    outbound: number
    newConversations: number
    deliveryRate: number | null
  }
  outboundStatus: Record<'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED', number>
  now: { unread: number; openWindows: number; withAgent: number }
  channels: {
    id: string
    name: string
    displayPhone: string | null
    qualityRating: string
    sendingPaused: boolean
    inbound: number
    outbound: number
  }[]
}

/** Delivered or read, out of everything that left the queue. Null when nothing did. */
function deliveryRate(s: Partial<Record<MessageStatus, number>>) {
  const reached = (s.DELIVERED ?? 0) + (s.READ ?? 0)
  const settled = reached + (s.SENT ?? 0) + (s.FAILED ?? 0)
  return settled ? reached / settled : null
}

export async function loadDashboard(orgId: string, range: RangeDays, channelId: string | null): Promise<DashboardData> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } })
  const tz = org?.timezone || 'Asia/Jakarta'
  const now = new Date()

  const days = lastDays(range, tz, now)
  const from = dayStart(days[0]!, tz)
  // The period just before, same length, for the deltas.
  const prevFrom = new Date(from.getTime() - range * 86_400_000)

  // The channel filter in the raw queries is a plain nullable parameter, not a
  // nested Prisma.sql fragment: in dev the client lives on globalThis across
  // hot reloads while Prisma.sql is re-imported, and a fragment from the
  // "other" copy is then sent as a value ($4) instead of SQL - a syntax error.

  const [messageRows, conversationRows, statusNow, statusPrev, unread, openWindows, withAgent, channelRows, channels] =
    await Promise.all([
      prisma.$queryRaw<{ day: string; dir: Direction; n: number }[]>`
        SELECT to_char(m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
               m.direction AS dir, COUNT(*)::int AS n
        FROM "Message" m
        JOIN "Conversation" c ON c.id = m."conversationId"
        JOIN "Channel" ch ON ch.id = c."channelId"
        WHERE ch."orgId" = ${orgId} AND m."createdAt" >= ${prevFrom}
          AND (${channelId}::text IS NULL OR c."channelId" = ${channelId})
        GROUP BY 1, 2`,
      prisma.$queryRaw<{ day: string; n: number }[]>`
        SELECT to_char(c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
        FROM "Conversation" c
        JOIN "Channel" ch ON ch.id = c."channelId"
        WHERE ch."orgId" = ${orgId} AND c."createdAt" >= ${prevFrom}
          AND (${channelId}::text IS NULL OR c."channelId" = ${channelId})
        GROUP BY 1`,
      statusCounts(orgId, channelId, from, null),
      statusCounts(orgId, channelId, prevFrom, from),
      prisma.conversation.count({ where: { channel: { orgId }, ...(channelId ? { channelId } : {}), unreadCount: { gt: 0 } } }),
      prisma.conversation.count({
        where: { channel: { orgId }, ...(channelId ? { channelId } : {}), windowExpiresAt: { gt: now } },
      }),
      prisma.conversation.count({ where: { channel: { orgId }, ...(channelId ? { channelId } : {}), botPaused: true } }),
      prisma.$queryRaw<{ channelId: string; dir: Direction; n: number }[]>`
        SELECT c."channelId", m.direction AS dir, COUNT(*)::int AS n
        FROM "Message" m
        JOIN "Conversation" c ON c.id = m."conversationId"
        JOIN "Channel" ch ON ch.id = c."channelId"
        WHERE ch."orgId" = ${orgId} AND m."createdAt" >= ${from}
        GROUP BY 1, 2`,
      prisma.channel.findMany({
        where: { orgId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, displayPhone: true, qualityRating: true, sendingPaused: true },
      }),
    ])

  const inRange = new Set(days)
  const series = (dir: Direction) =>
    days.map((d) => messageRows.find((r) => r.day === d && r.dir === dir)?.n ?? 0)
  const before = (rows: { day: string; n: number; dir?: Direction }[], dir?: Direction) =>
    rows.filter((r) => !inRange.has(r.day) && (!dir || r.dir === dir)).reduce((s, r) => s + r.n, 0)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

  const inbound = series(Direction.IN)
  const outbound = series(Direction.OUT)
  const newConversations = days.map((d) => conversationRows.find((r) => r.day === d)?.n ?? 0)

  const count = (dir: Direction, id: string) => channelRows.find((r) => r.channelId === id && r.dir === dir)?.n ?? 0

  return {
    days,
    inbound,
    outbound,
    newConversations,
    totals: {
      inbound: sum(inbound),
      outbound: sum(outbound),
      newConversations: sum(newConversations),
      deliveryRate: deliveryRate(statusNow),
    },
    previous: {
      inbound: before(messageRows, Direction.IN),
      outbound: before(messageRows, Direction.OUT),
      newConversations: before(conversationRows),
      deliveryRate: deliveryRate(statusPrev),
    },
    outboundStatus: {
      QUEUED: statusNow.QUEUED ?? 0,
      SENT: statusNow.SENT ?? 0,
      DELIVERED: statusNow.DELIVERED ?? 0,
      READ: statusNow.READ ?? 0,
      FAILED: statusNow.FAILED ?? 0,
    },
    now: { unread, openWindows, withAgent },
    channels: channels
      .filter((c) => !channelId || c.id === channelId)
      .map((c) => ({ ...c, inbound: count(Direction.IN, c.id), outbound: count(Direction.OUT, c.id) })),
  }
}

async function statusCounts(orgId: string, channelId: string | null, from: Date, to: Date | null) {
  const rows = await prisma.message.groupBy({
    by: ['status'],
    where: {
      direction: Direction.OUT,
      createdAt: { gte: from, ...(to ? { lt: to } : {}) },
      conversation: { channel: { orgId }, ...(channelId ? { channelId } : {}) },
    },
    _count: { _all: true },
  })
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<MessageStatus, number>>
}
