'use server'

import { revalidatePath } from 'next/cache'
import { prisma, Direction, MessageStatus, Prisma } from '@wa/db'
import {
  credentialsFor,
  isWindowOpen,
  providerFor,
  ProviderError,
  RE_ENGAGEMENT_CODE,
  WA_LIMITS,
} from '@wa/core'
import { requireUser } from '@/lib/auth'

export type SendState = { error?: string }

export async function sendReply(_prev: SendState, formData: FormData): Promise<SendState> {
  const user = await requireUser()
  if (user.role === 'VIEWER') return { error: 'Peran kamu hanya bisa membaca.' }

  const conversationId = String(formData.get('conversationId') ?? '')
  const body = String(formData.get('body') ?? '').trim()

  if (!body) return { error: 'Pesan kosong.' }
  if (body.length > WA_LIMITS.text.bodyMax) {
    return { error: `Pesan ${body.length} karakter, maksimum ${WA_LIMITS.text.bodyMax}.` }
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: true, contact: true },
  })
  if (!conversation || conversation.channel.orgId !== user.orgId) {
    return { error: 'Percakapan tidak ditemukan.' }
  }

  // Check before spending an API call. The error Meta returns for a closed
  // window does not say what to do instead, and the agent needs to know their
  // only option is an approved template.
  if (!isWindowOpen(conversation.windowExpiresAt)) {
    return {
      error: 'Window 24 jam sudah tertutup. Hanya template yang disetujui yang bisa dikirim.',
    }
  }
  if (conversation.channel.sendingPaused) {
    return { error: `Pengiriman dari ${conversation.channel.name} sedang dijeda.` }
  }

  const message = { kind: 'text' as const, body }

  let waMessageId: string
  try {
    const result = await providerFor(conversation.channel).send(
      credentialsFor(conversation.channel),
      conversation.contact.waId,
      message,
    )
    waMessageId = result.waMessageId
  } catch (err) {
    const detail =
      err instanceof ProviderError && err.code === String(RE_ENGAGEMENT_CODE)
        ? 'Meta menolak: window 24 jam tertutup.'
        : err instanceof Error
          ? err.message
          : String(err)

    await prisma.message.create({
      data: {
        conversationId,
        direction: Direction.OUT,
        type: 'text',
        payload: message as unknown as Prisma.InputJsonValue,
        status: MessageStatus.FAILED,
        errorMessage: detail,
        sentBy: `user:${user.id}`,
        sentByUserId: user.id,
      },
    })
    revalidatePath(`/inbox/${conversationId}`)
    return { error: detail }
  }

  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        direction: Direction.OUT,
        waMessageId,
        type: 'text',
        payload: message as unknown as Prisma.InputJsonValue,
        status: MessageStatus.SENT,
        sentBy: `user:${user.id}`,
        sentByUserId: user.id,
        sentAt: new Date(),
      },
    }),
    // An agent replying by hand takes over from the bot. Without this the flow
    // engine would keep answering on top of them.
    prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        unreadCount: 0,
        botPaused: true,
        assigneeId: conversation.assigneeId ?? user.id,
      },
    }),
  ])

  revalidatePath('/inbox')
  revalidatePath(`/inbox/${conversationId}`)
  return {}
}

export async function markRead(conversationId: string) {
  const user = await requireUser()
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: { select: { orgId: true } } },
  })
  if (!conversation || conversation.channel.orgId !== user.orgId) return

  await prisma.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } })
  revalidatePath('/inbox')
}

/** Hands the conversation back to the flow engine. */
export async function resumeBot(conversationId: string) {
  const user = await requireUser()
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: { select: { orgId: true } } },
  })
  if (!conversation || conversation.channel.orgId !== user.orgId) return

  await prisma.conversation.update({ where: { id: conversationId }, data: { botPaused: false } })
  revalidatePath(`/inbox/${conversationId}`)
}
