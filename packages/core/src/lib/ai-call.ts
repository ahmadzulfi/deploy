import { isIP } from 'node:net'
import { Agent, fetch } from 'undici'
import { buildAiRequest, renderAnswer, type AiEndpointConfig, type AiVars } from '../ai.js'
import { isLocalhostUrl, isPrivateAddress, publicOnlyLookup } from './public-url.js'

/**
 * Outbound HTTP for flows: the "Tanya AI" node and the "Panggil API" node.
 *
 * Kept out of the barrel so the dashboard only pulls undici in where it
 * actually calls out (the AI page's test button), not into every bundle.
 */

/**
 * Connects through a resolver that refuses private addresses, so a URL typed
 * into the dashboard can never reach the database, Redis or a cloud metadata
 * endpoint from inside our network - not even by DNS answering differently
 * between a check and the connection.
 */
const publicAgent = new Agent({ connect: { lookup: publicOnlyLookup as never } })

const devLocalhost = (url: URL) => process.env.NODE_ENV !== 'production' && isLocalhostUrl(url)

/** Why a URL may not be called, or null if it may. */
function refuse(url: URL): string | null {
  if (devLocalhost(url)) return null
  if (url.protocol !== 'https:') return 'URL harus https'
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // An IP literal never goes through the resolver, so it is judged here.
  if (isIP(host) && isPrivateAddress(host)) return `${host} adalah alamat jaringan internal`
  return null
}

export interface SafeResponse {
  status: number
  /** Parsed JSON, or the raw text when the body is not JSON. */
  data: unknown
}

/** A response body larger than this is cut; it ends up stored in session variables. */
const MAX_BODY_CHARS = 64_000

export async function safeFetch(
  rawUrl: string,
  init: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number },
): Promise<SafeResponse> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('URL tidak valid')
  }
  const refused = refuse(url)
  if (refused) throw new Error(refused)

  let res
  try {
    res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      dispatcher: devLocalhost(url) ? undefined : publicAgent,
      // A redirect could point anywhere, including inside our own network.
      redirect: 'manual',
      signal: AbortSignal.timeout(init.timeoutMs),
    })
  } catch (err) {
    throw new Error(describeFailure(err, init.timeoutMs))
  }

  const text = (await res.text()).slice(0, MAX_BODY_CHARS)
  let data: unknown = text
  try {
    data = JSON.parse(text)
  } catch {
    // Not JSON: the raw text is still usable.
  }
  return { status: res.status, data }
}

/** fetch reports every network failure as "fetch failed"; the useful part sits on the cause. */
function describeFailure(err: unknown, timeoutMs: number) {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `tidak ada jawaban dalam ${timeoutMs / 1000} detik`
  }
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause
  if (cause) return `${cause.code ?? ''} ${cause.message ?? ''}`.trim()
  return err instanceof Error ? err.message : String(err)
}

export type AiResult =
  | { ok: true; answer: string; status: number; data: unknown; ms: number }
  | { ok: false; error: string; status?: number; data?: unknown; ms: number }

/** Sends one question to a saved AI endpoint. Never throws. */
export async function callAi(cfg: AiEndpointConfig, vars: AiVars): Promise<AiResult> {
  const started = Date.now()
  const ms = () => Date.now() - started
  const req = buildAiRequest(cfg, vars)

  let res: SafeResponse
  try {
    res = await safeFetch(req.url, { ...req, timeoutMs: cfg.timeoutSeconds * 1000 })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), ms: ms() }
  }

  if (res.status < 200 || res.status >= 300) {
    const detail = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    return { ok: false, error: `HTTP ${res.status}: ${detail.slice(0, 300)}`, status: res.status, data: res.data, ms: ms() }
  }

  const answer = renderAnswer(cfg.answerTemplate, res.data)
  if (!answer) {
    return {
      ok: false,
      error: 'Jawaban kosong. Cek "Format jawaban" terhadap respons di bawah.',
      status: res.status,
      data: res.data,
      ms: ms(),
    }
  }
  return { ok: true, answer, status: res.status, data: res.data, ms: ms() }
}
