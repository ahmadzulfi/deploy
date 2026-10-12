'use server'

import { revalidatePath } from 'next/cache'
import { prisma, ConversationStatus, Direction, MessageStatus, Prisma, SessionStatus } from '@wa/db'
import {
  buildTemplateComponents,
  credentialsFor,
  emitEvent,
  messageEventData,
  isWindowOpen,
  providerFor,
  ProviderError,
  renderTemplate,
  RE_ENGAGEMENT_CODE,
  templateSlots,
  WA_LIMITS,
  type OutboundMessage,
} from '@wa/core'
import { requireUser } from '@/lib/auth'

export type SendState = { error?: string; ok?: number }

type User = Awaited<ReturnType<typeof requireUser>>

async function loadConversation(user: User, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: true, contact: true },
  })
  return conversation && conversation.channel.orgId === user.orgId ? conversation : null
}

type LoadedConversation = NonNullable<Awaited<ReturnType<typeof loadConversation>>>

/**
 * Sends one agent message synchronously and records it either way.
 *
 * Synchronous rather than through the outbound queue so the agent sees a
 * rejection right under the composer instead of a red bubble some seconds
 * later. `extra` rides along in the stored payload for display only.
 */
async function deliver(
  user: User,
  conversation: LoadedConversation,
  message: OutboundMessage,
  extra: Record<string, unknown> = {},
): Promise<SendState> {
  const payload = { ...message, ...extra } as unknown as Prisma.InputJsonValue

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

    const failed = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: Direction.OUT,
        type: message.kind,
        payload,
        status: MessageStatus.FAILED,
        errorCode: err instanceof ProviderError ? err.code : undefined,
        errorMessage: detail,
        sentBy: `user:${user.id}`,
        sentByUserId: user.id,
      },
    })
    await emitEvent(conversation.channel.orgId, 'message.failed', messageEventData(failed, conversation))
    revalidatePath(`/inbox/${conversation.id}`)
    return { error: detail }
  }

  const [sent] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: Direction.OUT,
        waMessageId,
        type: message.kind,
        payload,
        status: MessageStatus.SENT,
        sentBy: `user:${user.id}`,
        sentByUserId: user.id,
        sentAt: new Date(),
      },
    }),
    // An agent replying by hand takes over from the bot. Without this the flow
    // engine would keep answering on top of them.
    prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        unreadCount: 0,
        botPaused: true,
        // Refreshed on every manual reply, so the hand-back clock counts from
        // the agent's last word rather than from the handover.
        botPausedAt: new Date(),
        assigneeId: conversation.assigneeId ?? user.id,
      },
    }),
  ])

  await emitEvent(conversation.channel.orgId, 'message.sent', messageEventData(sent, conversation))

  revalidatePath('/inbox')
  revalidatePath(`/inbox/${conversation.id}`)
  return { ok: Date.now() }
}

export async function sendReply(_prev: SendState, formData: FormData): Promise<SendState> {
  const user = await requireUser()
  if (user.role === 'VIEWER') return { error: 'Peran kamu hanya bisa membaca.' }

  const conversationId = String(formData.get('conversationId') ?? '')
  const body = String(formData.get('body') ?? '').trim()

  if (!body) return { error: 'Pesan kosong.' }
  if (body.length > WA_LIMITS.text.bodyMax) {
    return { error: `Pesan ${body.length} karakter, maksimum ${WA_LIMITS.text.bodyMax}.` }
  }

  const conversation = await loadConversation(user, conversationId)
  if (!conversation) return { error: 'Percakapan tidak ditemukan.' }

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

  return deliver(user, conversation, { kind: 'text', body })
}

/**
 * Sends an approved template - the only thing Meta accepts once the 24h
 * window has closed, and the way an agent re-opens a quiet conversation.
 */
export async function sendTemplateReply(_prev: SendState, formData: FormData): Promise<SendState> {
  const user = await requireUser()
  if (user.role === 'VIEWER') return { error: 'Peran kamu hanya bisa membaca.' }

  const conversation = await loadConversation(user, String(formData.get('conversationId') ?? ''))
  if (!conversation) return { error: 'Percakapan tidak ditemukan.' }
  if (conversation.channel.sendingPaused) {
    return { error: `Pengiriman dari ${conversation.channel.name} sedang dijeda.` }
  }

  // Looked up by id and re-checked against this channel's WABA: templates
  // belong to one WABA, and a name that exists on another is not sendable
  // from this number.
  const template = await prisma.template.findUnique({ where: { id: String(formData.get('templateId') ?? '') } })
  if (!template || template.wabaId !== conversation.channel.wabaId) {
    return { error: 'Template tidak ditemukan untuk nomor ini.' }
  }
  if (template.metaStatus !== 'APPROVED') {
    return { error: `Template berstatus ${template.metaStatus}, belum bisa dikirim.` }
  }

  const values: Record<string, string> = {}
  for (const slot of templateSlots(template.components)) {
    const v = String(formData.get(`param:${slot.key}`) ?? '').trim()
    if (!v) return { error: 'Semua isian template wajib diisi.' }
    if (slot.format === 'image' || slot.format === 'video' || slot.format === 'document') {
      if (!/^https:\/\//i.test(v)) return { error: 'Link media header harus URL https publik.' }
    } else if (/[\n\t]/.test(v) || / {5,}/.test(v)) {
      // Meta rejects these inside a parameter with an error that names
      // neither the parameter nor the rule.
      return { error: 'Isian template tidak boleh berisi baris baru, tab, atau lebih dari 4 spasi berurutan.' }
    }
    values[slot.key] = v
  }

  return deliver(
    user,
    conversation,
    {
      kind: 'template',
      name: template.name,
      language: template.language,
      components: buildTemplateComponents(template.components, values),
    },
    { preview: renderTemplate(template.components, values) },
  )
}

export async function markRead(conversationId: string) {
  const user = await requireUser()
  // One query: the org check rides in the where clause instead of a lookup.
  await prisma.conversation.updateMany({
    where: { id: conversationId, channel: { orgId: user.orgId }, unreadCount: { gt: 0 } },
    data: { unreadCount: 0 },
  })
  // No revalidatePath: re-rendering the inbox layout would refetch the whole
  // sidebar just to drop one badge. ConversationRow hides it client-side.
}

/** Hands the conversation back to the flow engine. */
export async function resumeBot(conversationId: string) {
  const user = await requireUser()
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: { select: { orgId: true } } },
  })
  if (!conversation || conversation.channel.orgId !== user.orgId) return

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { botPaused: false, botPausedAt: null },
  })
  revalidatePath(`/inbox/${conversationId}`)
}

/**
 * Closes the conversation: it moves to the Selesai tab, any flow it is in the
 * middle of stops, and the bot takes the next message from the top. The next
 * inbound message reopens it.
 */
export async function endConversation(conversationId: string): Promise<{ error?: string }> {
  const user = await requireUser()
  if (user.role === 'VIEWER') return { error: 'Peran kamu hanya bisa membaca.' }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: { select: { orgId: true } } },
  })
  if (!conversation || conversation.channel.orgId !== user.orgId) return { error: 'Percakapan tidak ditemukan.' }
  if (conversation.status === ConversationStatus.CLOSED) return {}

  const [, sessions] = await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversationId },
      data: { status: ConversationStatus.CLOSED, botPaused: false, botPausedAt: null },
    }),
    // A flow left WAITING would swallow the contact's next message as the
    // answer to a question asked before the session ended.
    prisma.flowSession.updateMany({
      where: { conversationId, status: { in: [SessionStatus.ACTIVE, SessionStatus.WAITING] } },
      data: { status: SessionStatus.EXPIRED },
    }),
  ])

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'conversation.close',
      resourceType: 'Conversation',
      resourceId: conversationId,
      diff: { flowSessionsEnded: sessions.count },
    },
  })

  revalidatePath(`/inbox/${conversationId}`)
  revalidatePath('/inbox', 'layout')
  return {}
}

/** Puts a closed conversation back in the Terbuka tab without waiting for the contact. */
export async function reopenConversation(conversationId: string): Promise<{ error?: string }> {
  const user = await requireUser()
  if (user.role === 'VIEWER') return { error: 'Peran kamu hanya bisa membaca.' }

  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, channel: { orgId: user.orgId }, status: ConversationStatus.CLOSED },
    data: { status: ConversationStatus.OPEN },
  })
  if (count) {
    await prisma.auditLog.create({
      data: {
        orgId: user.orgId,
        actorId: user.id,
        action: 'conversation.reopen',
        resourceType: 'Conversation',
        resourceId: conversationId,
      },
    })
  }

  revalidatePath(`/inbox/${conversationId}`)
  revalidatePath('/inbox', 'layout')
  return {}
}
