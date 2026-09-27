'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma, CampaignStatus, ChannelStatus, TemplateStatus, type Prisma } from '@wa/db'
import { campaignAudienceSchema, templateSlots, type CampaignAudience } from '@wa/core'
import { requireRole } from '@/lib/auth'
import { estimateAudience } from '@/lib/audience'

export type CampaignState = { error?: string }

/** Broadcasts reach many people at once, so starting one takes a supervisor. */
const ROLE = 'SUPERVISOR' as const

function readAudience(formData: FormData): CampaignAudience {
  return campaignAudienceSchema.parse({
    tags: formData.getAll('tag').map(String).filter(Boolean),
    match: formData.get('match') === 'all' ? 'all' : 'any',
    optInOnly: formData.get('optInOnly') === 'on',
  })
}

/**
 * How many contacts a broadcast would reach, and how many it would hold back.
 * Same rules the runner applies when it starts.
 */
export async function countAudience(audience: CampaignAudience) {
  const user = await requireRole('AGENT')
  return estimateAudience(user.orgId, audience)
}

export async function createCampaign(_prev: CampaignState, formData: FormData): Promise<CampaignState> {
  const user = await requireRole(ROLE)

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Beri nama broadcast.' }

  const channel = await prisma.channel.findUnique({ where: { id: String(formData.get('channelId') ?? '') } })
  if (!channel || channel.orgId !== user.orgId) return { error: 'Pilih nomor pengirim.' }
  if (channel.status !== ChannelStatus.CONNECTED) return { error: `${channel.name} tidak terhubung.` }

  const template = await prisma.template.findUnique({ where: { id: String(formData.get('templateId') ?? '') } })
  // A template belongs to one WABA and is only sendable from its numbers.
  if (!template || template.wabaId !== channel.wabaId) return { error: 'Pilih template milik WABA nomor ini.' }
  if (template.metaStatus !== TemplateStatus.APPROVED) {
    return { error: `Template ${template.name} berstatus ${template.metaStatus}; hanya yang APPROVED bisa dipakai.` }
  }

  const variableMap: Record<string, string> = {}
  for (const slot of templateSlots(template.components)) {
    const v = String(formData.get(`param:${slot.key}`) ?? '').trim()
    if (!v) return { error: `Isian ${slot.key} wajib diisi.` }
    // A placeholder is resolved per contact and checked then; a literal link can be checked now.
    if (slot.key === 'header.media' && !v.includes('{{') && !/^https:\/\//i.test(v)) {
      return { error: 'Link media header harus URL https publik.' }
    }
    variableMap[slot.key] = v
  }

  const throttle = Number(formData.get('throttlePerMin') ?? 60)
  if (!Number.isInteger(throttle) || throttle < 1 || throttle > 1000) {
    return { error: 'Kecepatan harus 1–1000 pesan per menit.' }
  }

  // Sent as ISO by the form, converted in the browser: only the browser knows
  // which timezone the person typed the time in.
  const scheduleRaw = String(formData.get('scheduleAtIso') ?? '').trim()
  const scheduleAt = scheduleRaw ? new Date(scheduleRaw) : null
  if (scheduleAt && Number.isNaN(scheduleAt.getTime())) return { error: 'Jadwal tidak valid.' }
  if (scheduleAt && scheduleAt.getTime() < Date.now() - 60_000) return { error: 'Jadwal sudah lewat.' }

  const audience = readAudience(formData)

  const campaign = await prisma.campaign.create({
    data: {
      orgId: user.orgId,
      channelId: channel.id,
      templateId: template.id,
      name,
      audienceQuery: audience as unknown as Prisma.InputJsonValue,
      variableMap,
      scheduleAt,
      throttlePerMin: throttle,
      createdById: user.id,
    },
  })
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'campaign.create',
      resourceType: 'Campaign',
      resourceId: campaign.id,
      diff: { name, channelId: channel.id, template: template.name, audience } as unknown as Prisma.InputJsonValue,
    },
  })

  revalidatePath('/broadcast')
  redirect(`/broadcast/${campaign.id}`)
}

async function ownCampaign(orgId: string, id: string) {
  const c = await prisma.campaign.findUnique({ where: { id } })
  return c && c.orgId === orgId ? c : null
}

async function audit(orgId: string, actorId: string, action: string, id: string) {
  await prisma.auditLog.create({ data: { orgId, actorId, action, resourceType: 'Campaign', resourceId: id } })
}

/**
 * Hands the campaign to the runner. The dashboard never touches the queue:
 * the worker polls for campaigns in this state and picks it up within seconds.
 */
export async function startCampaign(id: string) {
  const user = await requireRole(ROLE)
  const c = await ownCampaign(user.orgId, id)
  if (!c || c.status !== CampaignStatus.DRAFT) return

  const later = c.scheduleAt && c.scheduleAt.getTime() > Date.now()
  await prisma.campaign.update({
    where: { id },
    data: { status: later ? CampaignStatus.SCHEDULED : CampaignStatus.RUNNING, lastTickAt: null, error: null },
  })
  await audit(user.orgId, user.id, 'campaign.start', id)
  revalidatePath(`/broadcast/${id}`)
  revalidatePath('/broadcast')
}

export async function pauseCampaign(id: string) {
  const user = await requireRole(ROLE)
  const c = await ownCampaign(user.orgId, id)
  if (!c || (c.status !== CampaignStatus.RUNNING && c.status !== CampaignStatus.SCHEDULED)) return

  await prisma.campaign.update({ where: { id }, data: { status: CampaignStatus.PAUSED } })
  await audit(user.orgId, user.id, 'campaign.pause', id)
  revalidatePath(`/broadcast/${id}`)
  revalidatePath('/broadcast')
}

export async function resumeCampaign(id: string) {
  const user = await requireRole(ROLE)
  const c = await ownCampaign(user.orgId, id)
  if (!c || c.status !== CampaignStatus.PAUSED) return

  // Not yet started and still in the future: back to waiting for the schedule.
  const later = !c.startedAt && c.scheduleAt && c.scheduleAt.getTime() > Date.now()
  await prisma.campaign.update({
    where: { id },
    data: { status: later ? CampaignStatus.SCHEDULED : CampaignStatus.RUNNING, lastTickAt: null, error: null },
  })
  await audit(user.orgId, user.id, 'campaign.resume', id)
  revalidatePath(`/broadcast/${id}`)
  revalidatePath('/broadcast')
}

/** Drafts only: anything that has sent keeps its report. */
export async function deleteCampaign(id: string) {
  const user = await requireRole(ROLE)
  const c = await ownCampaign(user.orgId, id)
  if (!c || c.status !== CampaignStatus.DRAFT) return

  await prisma.campaign.delete({ where: { id } })
  await audit(user.orgId, user.id, 'campaign.delete', id)
  revalidatePath('/broadcast')
  redirect('/broadcast')
}
