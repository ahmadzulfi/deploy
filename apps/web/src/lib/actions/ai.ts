'use server'

import { revalidatePath } from 'next/cache'
import { prisma, Prisma } from '@wa/db'
import {
  aiConfigOf,
  checkAiConfig,
  checkPublicUrl,
  checkRouteConfig,
  encrypt,
  routeExamplesFor,
  type AiEndpointConfig,
  type AiEndpointKind,
} from '@wa/core'
import { callAi, callRoute } from '@wa/core/ai-call'
import { requireRole } from '@/lib/auth'
import { aiUsage, routeTestCatalog } from '@/lib/ai'

export type AiFormState = { error?: string; saved?: boolean }

export type AiTestResult =
  | { ok: true; answer: string; status: number; ms: number; raw: string }
  | { ok: false; error: string; status?: number; ms?: number; raw?: string }

/** One router answer, with each id shown as the menu path it stands for. */
export type RouteTestResult =
  | {
      ok: true
      status: number
      ms: number
      raw: string
      /** Which menu the question was routed against, e.g. a flow's name. */
      catalog: string
      count: number
      /** Approved examples sent along with the menu. */
      examples: number
      /** The router's own score, also when it picked nothing. */
      score: number
      pick: { id: string; score: number; path: string | null } | null
      candidates: { id: string; score: number; path: string | null }[]
    }
  | { ok: false; error: string; status?: number; ms?: number; raw?: string; catalog?: string }

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
): Promise<{ error: string } | { id: string | null; kind: AiEndpointKind; cfg: AiEndpointConfig }> {
  const id = String(formData.get('id') ?? '') || null
  const existing = id ? await ownEndpoint(orgId, id) : null
  if (id && !existing) return { error: 'AI tidak ditemukan.' }

  // Fixed once created: nodes already pointing at it expect this kind.
  const kind: AiEndpointKind = existing ? existing.kind : formData.get('kind') === 'ROUTE' ? 'ROUTE' : 'ANSWER'

  const typed = String(formData.get('headers') ?? '').trim()
  const clear = formData.get('clearHeaders') === 'on'
  const headers = typed || clear || !existing ? typed : aiConfigOf(existing).headers
  const url = String(formData.get('url') ?? '').trim()
  const timeoutSeconds = Number(formData.get('timeoutSeconds') ?? 20)

  if (kind === 'ROUTE') {
    // The request and answer follow the /route contract; nothing to template.
    const cfg: AiEndpointConfig = { method: 'POST', url, headers, body: '', answerTemplate: '', timeoutSeconds }
    const bad = checkRouteConfig(cfg) ?? (await checkUrl(cfg.url))
    return bad ? { error: bad } : { id, kind, cfg }
  }

  const cfg: AiEndpointConfig = {
    method: formData.get('method') === 'GET' ? 'GET' : 'POST',
    url,
    headers,
    body: String(formData.get('body') ?? ''),
    answerTemplate: String(formData.get('answerTemplate') ?? '').trim(),
    timeoutSeconds,
  }

  const bad = checkAiConfig(cfg) ?? (await checkUrl(cfg.url))
  return bad ? { error: bad } : { id, kind, cfg }
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
  const { id, kind, cfg } = parsed

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
      : await prisma.aiEndpoint.create({ data: { ...data, kind, orgId: user.orgId }, select: { id: true } })
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
      diff: { name, kind, method: cfg.method, url: cfg.url },
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
    return { error: `Masih dipakai di flow ${usedIn.join(', ')}. Ganti dulu node AI yang memakainya di sana.` }
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
  if (parsed.kind === 'ROUTE') return { ok: false, error: 'AI ini jenis Arahkan ke menu; uji lewat tombolnya sendiri.' }

  const result = await callAi(parsed.cfg, { pertanyaan: question, nama: 'Uji Dashboard', nomor: '6280000000000' })
  const raw = result.data === undefined ? undefined : pretty(result.data)

  return result.ok
    ? { ok: true, answer: result.answer, status: result.status, ms: result.ms, raw: raw ?? '' }
    : { ok: false, error: result.error, status: result.status, ms: result.ms, raw }
}

/**
 * Routes one question against a real menu: the first flow that uses Arahkan
 * AI, else the first flow with a menu, else a small example. Testing against
 * the menu the contact will actually reach is the only test that says much.
 */
export async function testRouteEndpoint(formData: FormData): Promise<RouteTestResult> {
  const user = await requireRole('ADMIN')

  const question = String(formData.get('question') ?? '').trim()
  if (!question) return { ok: false, error: 'Tulis pertanyaan uji dulu.' }

  const parsed = await configFrom(formData, user.orgId)
  if ('error' in parsed) return { ok: false, error: parsed.error }
  if (parsed.kind !== 'ROUTE') return { ok: false, error: 'AI ini jenis Jawab pertanyaan.' }

  const catalog = await routeTestCatalog(user.orgId)
  const examples = catalog.flowId
    ? await routeExamplesFor(catalog.flowId, catalog.destinations.map((d) => d.id))
    : []
  const result = await callRoute(parsed.cfg, { question, destinations: catalog.destinations, examples })
  const raw = result.data === undefined ? undefined : pretty(result.data)
  if (!result.ok) return { ok: false, error: result.error, status: result.status, ms: result.ms, raw, catalog: catalog.label }

  const pathOf = new Map(catalog.destinations.map((d) => [d.id, d.path]))
  const named = (id: string, score: number) => ({ id, score, path: pathOf.get(id) ?? null })
  return {
    ok: true,
    status: result.status,
    ms: result.ms,
    raw: raw ?? '',
    catalog: catalog.label,
    count: catalog.destinations.length,
    examples: examples.length,
    score: result.score,
    pick: result.destinationId ? named(result.destinationId, result.score) : null,
    candidates: result.candidates.map((c) => named(c.id, c.score)),
  }
}

function pretty(data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  return text.length > 8000 ? `${text.slice(0, 8000)}\n…` : text
}
