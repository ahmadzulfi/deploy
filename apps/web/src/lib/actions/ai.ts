'use server'

import { revalidatePath } from 'next/cache'
import { prisma, Prisma } from '@wa/db'
import { aiConfigOf, checkAiConfig, checkPublicUrl, encrypt, type AiEndpointConfig } from '@wa/core'
import { callAi } from '@wa/core/ai-call'
import { requireRole } from '@/lib/auth'
import { aiUsage } from '@/lib/ai'

export type AiFormState = { error?: string; saved?: boolean }

export type AiTestResult =
  | { ok: true; answer: string; status: number; ms: number; raw: string }
  | { ok: false; error: string; status?: number; ms?: number; raw?: string }

async function ownEndpoint(orgId: string, id: string) {
  const e = await prisma.aiEndpoint.findUnique({ where: { id } })
  return e && e.orgId === orgId ? e : null
}

/**
 * The config the form describes. Header values are secret and never sent
 * back to the browser, so on an edit an empty header box means "keep what is
 * stored" - unless the admin ticked "hapus header".
 */
async function configFrom(
  formData: FormData,
  orgId: string,
): Promise<{ error: string } | { id: string | null; cfg: AiEndpointConfig }> {
  const id = String(formData.get('id') ?? '') || null
  const existing = id ? await ownEndpoint(orgId, id) : null
  if (id && !existing) return { error: 'AI tidak ditemukan.' }

  const typed = String(formData.get('headers') ?? '').trim()
  const clear = formData.get('clearHeaders') === 'on'
  const headers = typed || clear || !existing ? typed : aiConfigOf(existing).headers

  const cfg: AiEndpointConfig = {
    method: formData.get('method') === 'GET' ? 'GET' : 'POST',
    url: String(formData.get('url') ?? '').trim(),
    headers,
    body: String(formData.get('body') ?? ''),
    answerTemplate: String(formData.get('answerTemplate') ?? '').trim(),
    timeoutSeconds: Number(formData.get('timeoutSeconds') ?? 20),
  }

  const bad = checkAiConfig(cfg) ?? (await checkUrl(cfg.url))
  return bad ? { error: bad } : { id, cfg }
}

/**
 * The worker calls this URL from inside our network, so it gets the same
 * treatment as an outgoing webhook: https, and never an internal address.
 * Placeholders are swapped for a harmless value first - they are not part of
 * the host.
 */
function checkUrl(url: string) {
  return checkPublicUrl(url.replace(/\{\{\s*\w+\s*\}\}/g, 'x'), {
    allowLocalhost: process.env.NODE_ENV !== 'production',
  })
}

export async function saveAiEndpoint(_prev: AiFormState, formData: FormData): Promise<AiFormState> {
  const user = await requireRole('ADMIN')

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Beri nama supaya bisa dipilih di flow.' }
  if (name.length > 60) return { error: 'Nama maksimum 60 karakter.' }

  const parsed = await configFrom(formData, user.orgId)
  if ('error' in parsed) return { error: parsed.error }
  const { id, cfg } = parsed

  const data = {
    name,
    method: cfg.method,
    url: cfg.url,
    headersEnc: cfg.headers ? encrypt(cfg.headers) : null,
    body: cfg.method === 'POST' ? cfg.body : '',
    answerTemplate: cfg.answerTemplate,
    timeoutSeconds: cfg.timeoutSeconds,
  }

  let savedId: string
  try {
    const row = id
      ? await prisma.aiEndpoint.update({ where: { id }, data, select: { id: true } })
      : await prisma.aiEndpoint.create({ data: { ...data, orgId: user.orgId }, select: { id: true } })
    savedId = row.id
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { error: 'Nama ini sudah dipakai AI lain.' }
    }
    throw err
  }

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: id ? 'ai.update' : 'ai.create',
      resourceType: 'AiEndpoint',
      resourceId: savedId,
      // Never the headers: they hold the API key.
      diff: { name, method: cfg.method, url: cfg.url },
    },
  })

  revalidatePath('/ai')
  return { saved: true }
}

export async function deleteAiEndpoint(id: string): Promise<{ error?: string }> {
  const user = await requireRole('ADMIN')
  const e = await ownEndpoint(user.orgId, id)
  if (!e) return {}

  // Deleting it would silently send every one of these down the "gagal"
  // branch, so make the admin repoint them first.
  const usedIn = (await aiUsage(user.orgId)).get(id) ?? []
  if (usedIn.length) {
    return { error: `Masih dipakai di flow ${usedIn.join(', ')}. Ganti dulu node Tanya AI di sana.` }
  }

  await prisma.aiEndpoint.delete({ where: { id } })
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'ai.delete',
      resourceType: 'AiEndpoint',
      resourceId: id,
      diff: { name: e.name, url: e.url },
    },
  })
  revalidatePath('/ai')
  return {}
}

/** Sends one question with what the form currently holds, saved or not. */
export async function testAiEndpoint(formData: FormData): Promise<AiTestResult> {
  const user = await requireRole('ADMIN')

  const question = String(formData.get('question') ?? '').trim()
  if (!question) return { ok: false, error: 'Tulis pertanyaan uji dulu.' }

  const parsed = await configFrom(formData, user.orgId)
  if ('error' in parsed) return { ok: false, error: parsed.error }

  const result = await callAi(parsed.cfg, { pertanyaan: question, nama: 'Uji Dashboard', nomor: '6280000000000' })
  const raw = result.data === undefined ? undefined : pretty(result.data)

  return result.ok
    ? { ok: true, answer: result.answer, status: result.status, ms: result.ms, raw: raw ?? '' }
    : { ok: false, error: result.error, status: result.status, ms: result.ms, raw }
}

function pretty(data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  return text.length > 8000 ? `${text.slice(0, 8000)}\n…` : text
}
