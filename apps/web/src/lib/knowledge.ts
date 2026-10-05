/**
 * Client for the knowledge service (apps/ai-knowledge): the SOP documents the
 * AI answers from, and the semantic search over them.
 *
 * One service for the whole install, set in .env rather than per org - it
 * holds a single document table. Only server components and server actions
 * import this file, so the API key never reaches a browser.
 */

import type { KnowledgeInput } from './knowledge-rules'

export interface KnowledgeDoc {
  id: number
  category: string
  title: string
  content: string
  /** ISO string; null when the service did not say. */
  createdAt: string | null
}

export interface KnowledgeAnswer {
  /** "cache" when a near-identical question was answered before. */
  source: string
  /** For a cache hit: the earlier question this one matched. */
  matchedQuestion: string | null
  service: string
  category: string
  shortDescription: string
  longSummary: string
  /** Best document similarity, 0-1. */
  similarity: number | null
  sources: { id: number; category: string; title: string; similarity: number }[]
}

export type KnowledgeResult<T> = { ok: true; data: T } | { ok: false; error: string }

export function knowledgeConfig() {
  const url = (process.env.AI_KNOWLEDGE_URL ?? '').trim().replace(/\/+$/, '')
  return url ? { url, key: (process.env.AI_KNOWLEDGE_API_KEY ?? '').trim() } : null
}

/** Host only, for showing which service the page talks to. */
export function knowledgeHost() {
  const cfg = knowledgeConfig()
  if (!cfg) return null
  try {
    return new URL(cfg.url).host
  } catch {
    return cfg.url
  }
}

async function call<T>(
  path: string,
  { method = 'GET', body, timeoutMs }: { method?: string; body?: unknown; timeoutMs: number },
): Promise<KnowledgeResult<T>> {
  const cfg = knowledgeConfig()
  if (!cfg) return { ok: false, error: 'AI_KNOWLEDGE_URL belum diisi di .env.' }

  let res: Response
  try {
    res = await fetch(cfg.url + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cfg.key ? { 'X-Internal-API-Key': cfg.key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.name === 'TimeoutError'
          ? `Layanan pengetahuan tidak menjawab dalam ${timeoutMs / 1000} detik.`
          : `Layanan pengetahuan di ${cfg.url} tidak bisa dihubungi.`,
    }
  }

  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }

  if (!res.ok) {
    if (res.status === 401) return { ok: false, error: 'API key ditolak layanan pengetahuan. Periksa AI_KNOWLEDGE_API_KEY.' }
    const message = (data as { message?: unknown } | undefined)?.message
    return {
      ok: false,
      error: typeof message === 'string' && message ? message : `Layanan pengetahuan membalas ${res.status}.`,
    }
  }
  return { ok: true, data: data as T }
}

interface RawDoc {
  id: number
  category?: string
  title?: string
  content?: string
  created_at?: string
}

const toDoc = (d: RawDoc): KnowledgeDoc => ({
  id: d.id,
  category: d.category || 'Umum',
  title: d.title ?? '',
  content: d.content ?? '',
  createdAt: d.created_at ?? null,
})

const LIST_PAGE = 500
/** Far above any SOP set we expect; stops a runaway loop, nothing more. */
const LIST_MAX = 5000

/**
 * Every document, newest first. The service pages but cannot filter, and an
 * SOP set is a few hundred rows at most, so search and category filtering
 * happen here on the full list.
 */
export async function allDocuments(): Promise<KnowledgeResult<KnowledgeDoc[]>> {
  const docs: KnowledgeDoc[] = []
  for (let offset = 0; offset < LIST_MAX; offset += LIST_PAGE) {
    const res = await call<{ total?: number; data?: RawDoc[] | null }>(
      `/documents?limit=${LIST_PAGE}&offset=${offset}`,
      { timeoutMs: 10_000 },
    )
    if (!res.ok) return res
    const page = res.data.data ?? []
    docs.push(...page.map(toDoc))
    if (page.length < LIST_PAGE || docs.length >= Number(res.data.total ?? 0)) break
  }
  return { ok: true, data: docs.sort((a, b) => b.id - a.id) }
}

export async function getDocument(id: number): Promise<KnowledgeResult<KnowledgeDoc>> {
  const res = await call<{ data?: RawDoc }>(`/documents/${id}`, { timeoutMs: 10_000 })
  if (!res.ok) return res
  return res.data.data ? { ok: true, data: toDoc(res.data.data) } : { ok: false, error: 'Dokumen tidak ditemukan.' }
}

// Saving waits for Gemini to embed the text, so it gets far longer than a read.

export async function createDocument(input: KnowledgeInput): Promise<KnowledgeResult<{ id: number | null }>> {
  const res = await call<{ data?: { id?: number } }>('/documents', { method: 'POST', body: input, timeoutMs: 30_000 })
  return res.ok ? { ok: true, data: { id: res.data.data?.id ?? null } } : res
}

export async function updateDocument(id: number, input: KnowledgeInput): Promise<KnowledgeResult<null>> {
  const res = await call(`/documents/${id}`, { method: 'PUT', body: input, timeoutMs: 30_000 })
  return res.ok ? { ok: true, data: null } : res
}

export async function deleteDocument(id: number): Promise<KnowledgeResult<null>> {
  const res = await call(`/documents/${id}`, { method: 'DELETE', timeoutMs: 10_000 })
  return res.ok ? { ok: true, data: null } : res
}

interface RawSearch {
  source?: string
  matched_history?: string
  feedback?: {
    related_service?: string
    category?: string
    short_description?: string
    long_summary?: string
    best_similarity?: number
  } | null
  matched_sources?: { id: number; category?: string; title?: string; similarity?: number }[] | null
}

/** The same search the bot's AI node runs, so an admin sees what a resident would get. */
export async function searchKnowledge(query: string): Promise<KnowledgeResult<{ answer: KnowledgeAnswer; ms: number }>> {
  const started = Date.now()
  const res = await call<RawSearch>('/documents/search', { method: 'POST', body: { query, limit: 3 }, timeoutMs: 30_000 })
  if (!res.ok) return res

  const r = res.data
  const fb = r.feedback ?? {}
  const similarity = Number(fb.best_similarity)
  return {
    ok: true,
    data: {
      ms: Date.now() - started,
      answer: {
        source: r.source ?? '',
        matchedQuestion: r.source === 'cache' ? (r.matched_history ?? null) : null,
        service: fb.related_service ?? '',
        category: fb.category ?? '',
        shortDescription: fb.short_description ?? '',
        longSummary: fb.long_summary ?? '',
        similarity: Number.isFinite(similarity) ? similarity : null,
        sources: (r.matched_sources ?? []).map((s) => ({
          id: s.id,
          category: s.category ?? '',
          title: s.title ?? '',
          similarity: Number(s.similarity) || 0,
        })),
      },
    },
  }
}
