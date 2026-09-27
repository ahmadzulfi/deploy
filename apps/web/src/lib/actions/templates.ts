'use server'

import { revalidatePath } from 'next/cache'
import { prisma, TemplateStatus, type Prisma } from '@wa/db'
import {
  cloudApiProvider,
  credentialsFor,
  draftToComponents,
  ProviderError,
  syncTemplates as runSync,
  templateDraftSchema,
  validateTemplateDraft,
  type TemplateDraft,
} from '@wa/core'
import { hasRole, requireRole, requireUser } from '@/lib/auth'

export type SyncState = { message?: string; error?: string }

function revalidateTemplates() {
  revalidatePath('/templates', 'layout')
  revalidatePath('/channels')
  revalidatePath('/inbox', 'layout')
  revalidatePath('/flows', 'layout')
}

/**
 * Pulls the template list from Meta. Read-only on Meta's side, so any agent
 * may run it - the one who needs a template is usually the one in the inbox.
 */
export async function syncTemplates(): Promise<SyncState> {
  const user = await requireRole('AGENT')
  const results = await runSync(user.orgId)

  revalidateTemplates()

  if (results.length === 0) return { error: 'Belum ada nomor dengan WABA dan token untuk disinkronkan.' }

  const failed = results.filter((r) => r.error)
  const total = results.reduce((n, r) => n + (r.count ?? 0), 0)
  if (failed.length === results.length) {
    return { error: failed.map((r) => `${r.channelName}: ${r.error}`).join(' · ') }
  }
  return {
    message: `${total} template tersinkron.`,
    error: failed.length ? failed.map((r) => `${r.channelName}: ${r.error}`).join(' · ') : undefined,
  }
}

/** Meta's own words are the useful part of a rejected submit. */
function metaMessage(err: unknown) {
  if (err instanceof ProviderError) {
    return typeof err.details === 'string' && err.details ? `${err.message} — ${err.details}` : err.message
  }
  return err instanceof Error ? err.message : String(err)
}

/** A channel of this org under the WABA, whose token can speak for it. */
async function channelForWaba(orgId: string, wabaId: string) {
  return prisma.channel.findFirst({
    where: { orgId, wabaId, accessTokenEnc: { not: null }, phoneNumberId: { not: null } },
    orderBy: { createdAt: 'asc' },
    include: { connection: { select: { metaAppId: true } } },
  })
}

export type CreateTemplateState = { error?: string; fields?: Record<string, string>; id?: string }

/**
 * Submits a template written in the wizard to Meta for review and mirrors it
 * locally, so it shows up as pending straight away rather than after the
 * next sync. Creating templates spends the WABA's review quota and speaks for
 * the business, so it takes a supervisor.
 */
export async function createTemplate(input: { draft: TemplateDraft; wabaId: string }): Promise<CreateTemplateState> {
  const user = await requireUser()
  if (!hasRole(user, 'SUPERVISOR')) return { error: 'Membuat template butuh peran supervisor ke atas.' }

  const parsed = templateDraftSchema.safeParse(input.draft)
  if (!parsed.success) return { error: 'Isian template tidak lengkap.' }
  const draft = parsed.data
  const fields = validateTemplateDraft(draft)
  if (Object.keys(fields).length) return { error: 'Masih ada isian yang perlu diperbaiki.', fields }

  const channel = await channelForWaba(user.orgId, String(input.wabaId ?? ''))
  if (!channel) return { error: 'Pilih WABA yang punya nomor terhubung.' }

  const dupe = await prisma.template.findUnique({
    where: { wabaId_name_language: { wabaId: channel.wabaId!, name: draft.name, language: draft.language } },
  })
  if (dupe) return { error: `Template ${draft.name} (${draft.language}) sudah ada di WABA ini.`, fields: { name: 'Nama sudah dipakai.' } }

  const components = draftToComponents(draft)
  let res: Awaited<ReturnType<typeof cloudApiProvider.createTemplate>>
  try {
    res = await cloudApiProvider.createTemplate(credentialsFor(channel), {
      name: draft.name,
      language: draft.language,
      category: draft.category,
      components,
    })
  } catch (err) {
    return { error: `Meta menolak template: ${metaMessage(err)}` }
  }

  const status = (Object.values(TemplateStatus) as string[]).includes(res.status)
    ? (res.status as TemplateStatus)
    : TemplateStatus.PENDING
  const template = await prisma.template.create({
    data: {
      channelId: channel.id,
      wabaId: channel.wabaId!,
      name: draft.name,
      language: draft.language,
      // Meta may move a template to another category on submit; its answer wins.
      category: res.category,
      components: components as Prisma.InputJsonValue,
      metaTemplateId: res.metaTemplateId,
      metaStatus: status,
      syncedAt: new Date(),
    },
  })
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'template.create',
      resourceType: 'Template',
      resourceId: template.id,
      diff: { name: draft.name, language: draft.language, category: draft.category, metaCategory: res.category, status },
    },
  })

  revalidateTemplates()
  return { id: template.id }
}

export type DeleteTemplateState = { error?: string; ok?: boolean }

/**
 * Deletes a template on Meta and here. Meta frees the name only after 30
 * days, and campaigns that used the template keep pointing at it, so such a
 * row stays behind as DISABLED instead of vanishing from their history.
 */
export async function deleteTemplate(id: string): Promise<DeleteTemplateState> {
  const user = await requireUser()
  if (!hasRole(user, 'ADMIN')) return { error: 'Menghapus template butuh peran admin.' }

  const template = await prisma.template.findUnique({
    where: { id },
    include: { channel: true, _count: { select: { campaigns: true } } },
  })
  if (!template || template.channel.orgId !== user.orgId) return { error: 'Template tidak ditemukan.' }

  if (template.metaTemplateId) {
    try {
      await cloudApiProvider.deleteTemplate(credentialsFor(template.channel), {
        name: template.name,
        metaTemplateId: template.metaTemplateId,
      })
    } catch (err) {
      // Already gone on Meta's side is what we wanted anyway.
      if (!(err instanceof ProviderError && err.httpStatus === 404)) {
        return { error: `Meta menolak penghapusan: ${metaMessage(err)}` }
      }
    }
  }

  if (template._count.campaigns > 0) {
    await prisma.template.update({ where: { id }, data: { metaStatus: TemplateStatus.DISABLED } })
  } else {
    await prisma.template.delete({ where: { id } })
  }
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'template.delete',
      resourceType: 'Template',
      resourceId: id,
      diff: { name: template.name, language: template.language, metaTemplateId: template.metaTemplateId },
    },
  })

  revalidateTemplates()
  return { ok: true }
}
