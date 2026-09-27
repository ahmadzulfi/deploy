'use server'

import { revalidatePath } from 'next/cache'
import { prisma, QualityRating } from '@wa/db'
import { cloudApiProvider } from '@wa/core'
import { requireRole, requireUser } from '@/lib/auth'

/** Kill switch. Pauses outbound sending without disconnecting the channel. */
export async function toggleChannelPause(channelId: string) {
  const user = await requireRole('SUPERVISOR')

  const channel = await prisma.channel.findUnique({ where: { id: channelId } })
  if (!channel || channel.orgId !== user.orgId) throw new Error('channel tidak ditemukan')

  const paused = !channel.sendingPaused
  await prisma.channel.update({
    where: { id: channelId },
    data: { sendingPaused: paused, pausedReason: paused ? `dijeda oleh ${user.name}` : null },
  })

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: paused ? 'channel.pause' : 'channel.resume',
      resourceType: 'Channel',
      resourceId: channelId,
    },
  })

  revalidatePath('/channels')
}

/** Re-reads quality rating and tier from Meta. */
export async function refreshChannelHealth(channelId: string) {
  await requireUser()

  const channel = await prisma.channel.findUnique({ where: { id: channelId } })
  if (!channel?.accessTokenEnc || !channel.phoneNumberId || !channel.wabaId) return

  const { credentialsFor } = await import('@wa/core')
  const health = await cloudApiProvider.getPhoneNumberHealth(credentialsFor(channel))

  await prisma.channel.update({
    where: { id: channelId },
    data: {
      displayPhone: health.displayPhone,
      qualityRating: (health.qualityRating as QualityRating) ?? QualityRating.UNKNOWN,
      messagingTier: health.messagingTier,
      lastHealthCheck: new Date(),
    },
  })

  revalidatePath('/channels')
}
