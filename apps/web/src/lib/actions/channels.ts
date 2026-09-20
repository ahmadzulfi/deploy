'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma, ChannelStatus, QualityRating } from '@wa/db'
import { cloudApiProvider, encrypt, env } from '@wa/core'
import { requireRole, requireUser } from '@/lib/auth'

const schema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi'),
  wabaId: z.string().trim().regex(/^\d+$/, 'WABA ID hanya angka'),
  phoneNumberId: z.string().trim().regex(/^\d+$/, 'Phone number ID hanya angka'),
  token: z.string().trim().min(20, 'Token terlalu pendek'),
})

export type ChannelFormState = { error?: string; ok?: string }

/**
 * Registers a number from the dashboard - the form equivalent of the
 * `channel:add` CLI.
 *
 * Verifies against the Graph API before writing anything, so a typo surfaces
 * as a form error rather than a channel that silently never receives traffic.
 */
export async function addChannel(
  _prev: ChannelFormState,
  formData: FormData,
): Promise<ChannelFormState> {
  const user = await requireRole('ADMIN')

  const parsed = schema.safeParse({
    name: formData.get('name'),
    wabaId: formData.get('wabaId'),
    phoneNumberId: formData.get('phoneNumberId'),
    token: formData.get('token'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Input tidak valid' }
  }

  const { name, wabaId, phoneNumberId, token } = parsed.data
  const creds = {
    channelId: 'pending',
    phoneNumberId,
    wabaId,
    accessToken: token,
    graphVersion: env().META_GRAPH_VERSION,
  }

  let health
  try {
    health = await cloudApiProvider.getPhoneNumberHealth(creds)
    await cloudApiProvider.subscribeApp(creds)
  } catch (err) {
    return { error: `Meta menolak: ${err instanceof Error ? err.message : String(err)}` }
  }

  const data = {
    name,
    wabaId,
    displayPhone: health.displayPhone,
    accessTokenEnc: encrypt(token),
    status: ChannelStatus.CONNECTED,
    qualityRating: (health.qualityRating as QualityRating) ?? QualityRating.UNKNOWN,
    messagingTier: health.messagingTier,
    lastHealthCheck: new Date(),
  }

  await prisma.channel.upsert({
    where: { phoneNumberId },
    create: { orgId: user.orgId, phoneNumberId, ...data },
    update: data,
  })

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'channel.add',
      resourceType: 'Channel',
      resourceId: phoneNumberId,
      diff: { name, wabaId, displayPhone: health.displayPhone },
    },
  })

  revalidatePath('/channels')
  return { ok: `${health.displayPhone} tersambung` }
}

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
