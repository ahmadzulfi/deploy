import { prisma, SessionStatus } from '@wa/db'
import { isWindowOpen, logger } from '@wa/core'
import { enqueueSend } from './outbound.js'

const log = logger.child({ worker: 'sweeper' })

/** How often the backstop runs. */
const SWEEP_INTERVAL_MS = 60_000

/**
 * Head start the queued timeout gets before the sweeper steps in.
 *
 * A waitReply node has its own "no answer" branch, which may send a parting
 * message. That branch belongs to the timeout job, so the sweeper must not
 * race it - it only cleans up after a deadline that nothing came to collect.
 */
const GRACE_MS = 5 * 60_000

/**
 * Nothing may hold a session open longer than this, whatever node it sits on.
 *
 * Matches WhatsApp's 24-hour window: past it the bot cannot send a free-form
 * message anyway, so a session still standing is dead weight.
 */
const HARD_LIMIT_MS = 24 * 60 * 60_000

/**
 * How long an agent may go quiet before the bot takes the conversation back.
 *
 * Handover mutes the bot for this contact and only a human can unmute it. An
 * agent who forgets leaves the contact talking to nobody, with nothing on
 * screen to say why.
 */
const HANDOVER_IDLE_MS = 2 * 60 * 60_000

/** Said to the contact on the way out, so the silence has an explanation. */
const HANDOVER_CLOSING_TEXT =
  'Terima kasih sudah menghubungi kami. Percakapan dengan tim kami ditutup dulu ya. ' +
  'Kalau masih ada yang perlu dibantu, ketik *mulai* untuk kembali ke menu. 🙏'

/**
 * Closes sessions the queue forgot.
 *
 * Every deadline the engine sets lives as a delayed job in Redis: lose the
 * queue and the session parks forever, which is exactly the failure this
 * guards against. It reads Postgres and nothing else, so it keeps working
 * when the queue does not.
 */
export async function sweepStaleSessions(now = new Date()) {
  const { count } = await prisma.flowSession.updateMany({
    where: {
      status: { in: [SessionStatus.ACTIVE, SessionStatus.WAITING] },
      OR: [
        // A deadline that passed with no timeout job to act on it.
        { expiresAt: { lt: new Date(now.getTime() - GRACE_MS) } },
        // Anything untouched for a day, including a delay whose resume job
        // vanished and a session left ACTIVE by a worker that died mid-tick.
        { updatedAt: { lt: new Date(now.getTime() - HARD_LIMIT_MS) } },
      ],
    },
    data: { status: SessionStatus.EXPIRED },
  })

  if (count > 0) log.info({ count }, 'sesi basi ditutup')
  return count
}

/**
 * Hands conversations back to the bot after the agent has gone quiet.
 *
 * `botPausedAt` is refreshed by every manual reply, so the clock runs from the
 * agent's last word, not from the handover itself.
 */
export async function resumeIdleHandovers(now = new Date()) {
  // Conversations paused before this column existed carry no clock. Starting
  // one now is kinder than both alternatives: handing them back on the spot,
  // or leaving them muted for good.
  await prisma.conversation.updateMany({
    where: { botPaused: true, botPausedAt: null },
    data: { botPausedAt: now },
  })

  const stale = await prisma.conversation.findMany({
    where: {
      botPaused: true,
      botPausedAt: { lt: new Date(now.getTime() - HANDOVER_IDLE_MS) },
    },
    include: { contact: { select: { waId: true } } },
  })

  for (const c of stale) {
    await prisma.conversation.update({
      where: { id: c.id },
      data: { botPaused: false, botPausedAt: null },
    })

    // Past the 24-hour window only an approved template would go through, and
    // spending one just to say goodbye is not worth it. The hand-back still
    // stands; the contact simply hears nothing until they write again.
    if (!isWindowOpen(c.windowExpiresAt, now)) continue

    await enqueueSend({
      channelId: c.channelId,
      conversationId: c.id,
      to: c.contact.waId,
      message: { kind: 'text', body: HANDOVER_CLOSING_TEXT },
      sentBy: 'system',
    })
  }

  if (stale.length > 0) log.info({ count: stale.length }, 'bot dikembalikan setelah agen diam')
  return stale.length
}

/** Runs both sweeps on an interval until `stop()`. Safe to call once at boot. */
export function startSessionSweeper() {
  const run = () => {
    void sweepStaleSessions().catch((err) => log.error(err, 'sweep sesi gagal'))
    void resumeIdleHandovers().catch((err) => log.error(err, 'sweep handover gagal'))
  }

  run()
  const timer = setInterval(run, SWEEP_INTERVAL_MS)
  // Left alone this would keep the process alive on its own during shutdown.
  timer.unref()

  return { stop: () => clearInterval(timer) }
}
