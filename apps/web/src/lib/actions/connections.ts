'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma, ChannelStatus, QualityRating, Prisma } from '@wa/db'
import { cloudApiProvider, encrypt, clearConnectionCache, connectionCredentials } from '@wa/core'
import { requireRole, requireUser } from '@/lib/auth'

export type ConnState = { error?: string; ok?: string }

const schema = z.object({
  name: z.string().trim().min(1, 'Beri nama koneksi ini'),
  wabaId: z.string().trim().regex(/^\d+$/, 'WABA ID hanya angka'),
  metaAppId: z.string().trim().regex(/^\d*$/, 'App ID hanya angka').optional(),
  appSecret: z.string().trim().min(16, 'App secret terlalu pendek'),
  accessToken: z.string().trim().min(20, 'Access token terlalu pendek'),
  graphVersion: z.string().trim().default('v21.0'),
})

/**
 * Connects a WABA and discovers its numbers in one step.
 *
 * Credentials are checked against the Graph API before anything is written, so
 * a wrong token surfaces as a form error rather than as a connection that
 * silently never receives traffic.
 */
export async function addConnection(_prev: ConnState, formData: FormData): Promise<ConnState> {
  const user = await requireRole('ADMIN')

  const parsed = schema.safeParse({
    name: formData.get('name'),
    wabaId: formData.get('wabaId'),
    metaAppId: formData.get('metaAppId') || undefined,
    appSecret: formData.get('appSecret'),
    accessToken: formData.get('accessToken'),
    graphVersion: formData.get('graphVersion') || 'v21.0',
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Input tidak valid' }

  const d = parsed.data
  const creds = {
    channelId: 'pending',
    phoneNumberId: 'pending',
    wabaId: d.wabaId,
    accessToken: d.accessToken,
    graphVersion: d.graphVersion,
  }

  let numbers
  try {
    numbers = await cloudApiProvider.listPhoneNumbers(creds)
    await cloudApiProvider.subscribeApp(creds)
  } catch (err) {
    return { error: `Meta menolak: ${err instanceof Error ? err.message : String(err)}` }
  }

  const existing = await prisma.wabaConnection.findUnique({
    where: { orgId_wabaId: { orgId: user.orgId, wabaId: d.wabaId } },
  })
  if (existing) return { error: 'WABA ini sudah terhubung.' }

  const connection = await prisma.wabaConnection.create({
    data: {
      orgId: user.orgId,
      name: d.name,
      wabaId: d.wabaId,
      metaAppId: d.metaAppId || null,
      appSecretEnc: encrypt(d.appSecret),
      accessTokenEnc: encrypt(d.accessToken),
      // Generated here rather than asked for: it only has to match what the
      // user pastes into Meta, and a random one cannot be guessed.
      verifyToken: randomBytes(18).toString('base64url'),
      graphVersion: d.graphVersion,
      status: ChannelStatus.CONNECTED,
      lastSyncAt: new Date(),
    },
  })

  await syncNumbersInto(connection.id, user.orgId, d.accessToken, d.wabaId, d.graphVersion, numbers)

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'connection.add',
      resourceType: 'WabaConnection',
      resourceId: connection.id,
      diff: { name: d.name, wabaId: d.wabaId, numbers: numbers.length },
    },
  })

  revalidatePath('/settings')
  revalidatePath('/channels')
  return { ok: `Terhubung. ${numbers.length} nomor ditemukan.` }
}

/** Re-reads the numbers under a connection and their quality ratings. */
export async function syncConnection(connectionId: string) {
  const user = await requireRole('SUPERVISOR')

  const conn = await prisma.wabaConnection.findUnique({ where: { id: connectionId } })
  if (!conn || conn.orgId !== user.orgId) return

  const c = connectionCredentials(conn)
  try {
    const numbers = await cloudApiProvider.listPhoneNumbers({
      channelId: 'sync',
      phoneNumberId: 'sync',
      ...c,
    })
    await syncNumbersInto(conn.id, conn.orgId, c.accessToken, c.wabaId, c.graphVersion, numbers)
    await prisma.wabaConnection.update({
      where: { id: conn.id },
      data: { lastSyncAt: new Date(), lastError: null, status: ChannelStatus.CONNECTED },
    })
  } catch (err) {
    await prisma.wabaConnection.update({
      where: { id: conn.id },
      data: {
        lastError: err instanceof Error ? err.message : String(err),
        status: ChannelStatus.FLAGGED,
      },
    })
  }

  revalidatePath('/settings')
  revalidatePath('/channels')
}

export async function removeConnection(connectionId: string) {
  const user = await requireRole('ADMIN')

  const conn = await prisma.wabaConnection.findUnique({ where: { id: connectionId } })
  if (!conn || conn.orgId !== user.orgId) return

  // Channels keep their history and their own token; only the link goes.
  await prisma.channel.updateMany({
    where: { connectionId },
    data: { connectionId: null, status: ChannelStatus.DISCONNECTED },
  })
  await prisma.wabaConnection.delete({ where: { id: connectionId } })
  clearConnectionCache(connectionId)

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'connection.remove',
      resourceType: 'WabaConnection',
      resourceId: connectionId,
      diff: { name: conn.name, wabaId: conn.wabaId },
    },
  })

  revalidatePath('/settings')
  revalidatePath('/channels')
}

/** Upserts a Channel row per discovered number, without touching history. */
async function syncNumbersInto(
  connectionId: string,
  orgId: string,
  accessToken: string,
  wabaId: string,
  graphVersion: string,
  numbers: {
    phoneNumberId: string
    displayPhone: string
    verifiedName: string | null
    qualityRating: string
    messagingTier: string
  }[],
) {
  for (const n of numbers) {
    const shared = {
      orgId,
      connectionId,
      wabaId,
      displayPhone: n.displayPhone,
      // Each channel keeps its own copy so a channel still works if the
      // connection is later unlinked.
      accessTokenEnc: encrypt(accessToken),
      qualityRating: (n.qualityRating as QualityRating) ?? QualityRating.UNKNOWN,
      messagingTier: n.messagingTier,
      status: ChannelStatus.CONNECTED,
      lastHealthCheck: new Date(),
    } satisfies Prisma.ChannelUncheckedUpdateInput

    await prisma.channel.upsert({
      where: { phoneNumberId: n.phoneNumberId },
      create: {
        ...shared,
        phoneNumberId: n.phoneNumberId,
        name: n.verifiedName || n.displayPhone,
      },
      update: shared,
    })
  }
  void graphVersion
}

export async function listConnections() {
  const user = await requireUser()
  return prisma.wabaConnection.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { channels: true } } },
  })
}
