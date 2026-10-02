'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@wa/db'
import { encrypt, clearMetaSettingsCache, hashApiKey, API_SCOPES as CORE_SCOPES } from '@wa/core'
import { requireRole } from '@/lib/auth'

export type SettingsState = { error?: string; ok?: string }

const metaSchema = z.object({
  appSecret: z.string().trim(),
  verifyToken: z.string().trim().min(8, 'Verify token minimal 8 karakter'),
})

/**
 * Stores the Meta app-level settings.
 *
 * An empty app secret field means "leave it alone" rather than "clear it" -
 * the form never renders the current value, so a blank submit must not wipe a
 * working secret.
 */
export async function saveMetaSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireRole('ADMIN')

  const parsed = metaSchema.safeParse({
    appSecret: formData.get('appSecret'),
    verifyToken: formData.get('verifyToken'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Input tidak valid' }

  const { appSecret, verifyToken } = parsed.data

  await prisma.organization.update({
    where: { id: user.orgId },
    data: {
      webhookVerifyToken: verifyToken,
      ...(appSecret ? { metaAppSecretEnc: encrypt(appSecret) } : {}),
    },
  })

  clearMetaSettingsCache()
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'settings.meta',
      resourceType: 'Organization',
      resourceId: user.orgId,
      diff: { appSecretChanged: Boolean(appSecret), verifyTokenChanged: true },
    },
  })

  revalidatePath('/settings')
  return { ok: appSecret ? 'Tersimpan. App secret diperbarui.' : 'Tersimpan.' }
}

export type ApiKeyState = { error?: string; created?: string }

// One list, shared with the API that enforces it.
const SCOPES = CORE_SCOPES

/**
 * Issues an API key for an internal system to call this platform.
 *
 * The plaintext is returned exactly once and only the SHA-256 of it is
 * stored, so a leaked database cannot be replayed against the API.
 */
export async function createApiKey(
  _prev: ApiKeyState,
  formData: FormData,
): Promise<ApiKeyState> {
  const user = await requireRole('ADMIN')

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Beri nama supaya nanti bisa dikenali.' }

  const scopes = SCOPES.filter((s) => formData.get(`scope:${s}`) === 'on')
  if (scopes.length === 0) return { error: 'Pilih minimal satu izin.' }

  // None ticked = every number, including ones connected later. Ticked ones
  // are re-checked against the org so a forged id cannot slip in.
  const requested = formData.getAll('channel').map(String).filter(Boolean)
  const channelIds = requested.length
    ? (
        await prisma.channel.findMany({
          where: { orgId: user.orgId, id: { in: requested } },
          select: { id: true },
        })
      ).map((c) => c.id)
    : []
  if (requested.length && channelIds.length !== requested.length) return { error: 'Nomor yang dipilih tidak ditemukan.' }

  const plain = `wa_${randomBytes(24).toString('base64url')}`

  await prisma.apiKey.create({
    data: {
      orgId: user.orgId,
      name,
      hashedKey: hashApiKey(plain),
      scopes: [...scopes],
      channelIds,
    },
  })

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'apikey.create',
      resourceType: 'ApiKey',
      diff: { name, scopes, channelIds },
    },
  })

  revalidatePath('/settings')
  return { created: plain }
}

export async function revokeApiKey(id: string) {
  const user = await requireRole('ADMIN')

  const key = await prisma.apiKey.findUnique({ where: { id }, select: { orgId: true, name: true } })
  if (!key || key.orgId !== user.orgId) return

  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } })
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'apikey.revoke',
      resourceType: 'ApiKey',
      resourceId: id,
      diff: { name: key.name },
    },
  })

  revalidatePath('/settings')
}
