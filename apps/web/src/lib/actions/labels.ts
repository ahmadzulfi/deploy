'use server'

import { revalidatePath } from 'next/cache'
import { prisma, Prisma } from '@wa/db'
import { LABELS_PER_ORG_MAX, checkLabel, cleanLabelName } from '@wa/core'
import { requireRole, requireUser } from '@/lib/auth'

export type LabelFormState = { error?: string; saved?: boolean }

async function ownLabel(orgId: string, id: string) {
  const l = await prisma.label.findUnique({ where: { id } })
  return l && l.orgId === orgId ? l : null
}

function refresh() {
  revalidatePath('/settings/labels')
  // Chips show on every inbox row, which the inbox layout renders.
  revalidatePath('/inbox', 'layout')
}

/** Creates a label, or edits one when the form carries an id. */
export async function saveLabel(_prev: LabelFormState, formData: FormData): Promise<LabelFormState> {
  const user = await requireRole('SUPERVISOR')

  const id = String(formData.get('id') ?? '') || null
  const input = {
    name: cleanLabelName(String(formData.get('name') ?? '')),
    description: String(formData.get('description') ?? '').trim(),
    color: String(formData.get('color') ?? ''),
  }
  const bad = checkLabel(input)
  if (bad) return { error: bad }

  const existing = id ? await ownLabel(user.orgId, id) : null
  if (id && !existing) return { error: 'Label tidak ditemukan.' }

  // The unique index is case-sensitive, but "Komplain" next to "komplain" in
  // the picker is a mistake, not two labels.
  const clash = await prisma.label.findFirst({
    where: {
      orgId: user.orgId,
      name: { equals: input.name, mode: 'insensitive' },
      ...(id ? { id: { not: id } } : {}),
    },
    select: { id: true },
  })
  if (clash) return { error: 'Nama ini sudah dipakai label lain.' }

  if (!id) {
    const count = await prisma.label.count({ where: { orgId: user.orgId } })
    if (count >= LABELS_PER_ORG_MAX) return { error: `Maksimal ${LABELS_PER_ORG_MAX} label. Hapus yang tidak dipakai dulu.` }
  }

  const data = { name: input.name, description: input.description || null, color: input.color }
  let savedId: string
  try {
    const row = id
      ? await prisma.label.update({ where: { id }, data, select: { id: true } })
      : await prisma.label.create({ data: { ...data, orgId: user.orgId }, select: { id: true } })
    savedId = row.id
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { error: 'Nama ini sudah dipakai label lain.' }
    }
    throw err
  }

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: id ? 'label.update' : 'label.create',
      resourceType: 'Label',
      resourceId: savedId,
      diff: existing ? { from: { name: existing.name, color: existing.color }, to: data } : data,
    },
  })

  refresh()
  return { saved: true }
}

/** Takes the label off every conversation; the conversations stay. */
export async function deleteLabel(id: string): Promise<{ error?: string }> {
  const user = await requireRole('SUPERVISOR')
  const label = await ownLabel(user.orgId, id)
  if (!label) return {}

  await prisma.label.delete({ where: { id } })
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'label.delete',
      resourceType: 'Label',
      resourceId: id,
      diff: { name: label.name, color: label.color },
    },
  })

  refresh()
  return {}
}

/**
 * Makes a conversation carry exactly these labels.
 *
 * The whole set rather than add/remove, so two agents ticking boxes at once
 * each end up with what they last saw instead of a toggle undoing the other.
 */
export async function setConversationLabels(conversationId: string, labelIds: string[]): Promise<{ error?: string }> {
  const user = await requireUser()
  if (user.role === 'VIEWER') return { error: 'Peran kamu hanya bisa membaca.' }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, channel: { select: { orgId: true } } },
  })
  if (!conversation || conversation.channel.orgId !== user.orgId) return { error: 'Percakapan tidak ditemukan.' }

  // Ids from the browser: keep only labels this org owns.
  const wanted = await prisma.label.findMany({
    where: { orgId: user.orgId, id: { in: [...new Set(labelIds)] } },
    select: { id: true },
  })
  const ids = wanted.map((l) => l.id)

  await prisma.$transaction([
    prisma.conversationLabel.deleteMany({ where: { conversationId, labelId: { notIn: ids } } }),
    prisma.conversationLabel.createMany({
      data: ids.map((labelId) => ({ conversationId, labelId, addedById: user.id })),
      skipDuplicates: true,
    }),
  ])

  revalidatePath(`/inbox/${conversationId}`)
  revalidatePath('/inbox', 'layout')
  return {}
}
