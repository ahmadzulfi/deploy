/**
 * Saved AI endpoints: how one request to an outside AI service is built, and
 * how its answer is read back.
 *
 * Deliberately provider-neutral. An endpoint is just a request template plus
 * an answer template, so the same code talks to a retrieval service, an
 * OpenAI-style chat API or Claude - the presets below only pre-fill the form.
 *
 * Pure: no network, no database. The call itself lives in lib/ai-call.ts,
 * which the dashboard bundle never imports.
 */

export interface AiEndpointConfig {
  method: 'GET' | 'POST'
  /** May hold {{pertanyaan}}, {{nama}}, {{nomor}}; values are percent-encoded. */
  url: string
  /** One `Name: value` per line, plaintext. Stored encrypted. */
  headers: string
  /** JSON for POST. Placeholders inside it are JSON-escaped. */
  body: string
  /** How the reply is shown, e.g. `{{choices.0.message.content}}`. */
  answerTemplate: string
  timeoutSeconds: number
}

/** What a request template may refer to. */
export interface AiVars {
  pertanyaan: string
  nama?: string
  nomor?: string
}

export const AI_PLACEHOLDERS = ['pertanyaan', 'nama', 'nomor'] as const

export const AI_TIMEOUT_MAX = 30

const REQUEST_SLOT = /\{\{\s*(\w+)\s*\}\}/g
const ANSWER_SLOT = /\{\{\s*([^{}]+?)\s*\}\}/g

/** Escapes a value for use inside a JSON string literal the admin wrote. */
export function jsonEscape(value: string) {
  return JSON.stringify(value).slice(1, -1)
}

function fill(template: string, vars: AiVars, escape: (v: string) => string = (v) => v) {
  return template.replace(REQUEST_SLOT, (_, name: string) => {
    const value = (vars as unknown as Record<string, string | undefined>)[name] ?? ''
    return escape(value)
  })
}

export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}

export function headerNames(text: string) {
  return Object.keys(parseHeaderLines(text))
}

export interface AiRequest {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  body?: string
}

export function buildAiRequest(cfg: AiEndpointConfig, vars: AiVars): AiRequest {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(parseHeaderLines(cfg.headers))) {
    // A contact's name must not be able to start a second header line.
    headers[name] = fill(value, vars).replace(/[\r\n]+/g, ' ')
  }

  const body = cfg.method === 'POST' && cfg.body.trim() ? fill(cfg.body, vars, jsonEscape) : undefined
  if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json'
  }

  return { method: cfg.method, url: fill(cfg.url, vars, encodeURIComponent), headers, body }
}

/**
 * Reads one value out of a parsed response.
 *
 * `a.b.0.c` walks objects and arrays. `list[type=text]` keeps only the array
 * elements whose `type` is "text" - needed for APIs such as Claude's, whose
 * `content` array may start with thinking or fallback blocks, so the text is
 * not reliably at index 0. After a filter the result is a list.
 */
export function readPath(root: unknown, path: string): unknown {
  let current: unknown[] = [root]
  let many = false

  for (const m of path.matchAll(/\[\s*([^\]=]+?)\s*=\s*([^\]]*?)\s*\]|([^.[\]]+)/g)) {
    if (m[3] !== undefined) {
      const key = m[3].trim()
      current = current.map((v) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined))
    } else {
      const [key, want] = [m[1]!, m[2]!]
      many = true
      current = current.flatMap((v) =>
        Array.isArray(v)
          ? v.filter((el) => el !== null && typeof el === 'object' && String((el as Record<string, unknown>)[key]) === want)
          : [],
      )
    }
  }

  const found = current.filter((v) => v !== undefined && v !== null)
  return many ? found : found[0]
}

function show(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) {
    return value.every((v) => typeof v === 'string') ? value.join('\n\n') : JSON.stringify(value)
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/**
 * Turns a response into the text a contact will read. A blank template means
 * "the whole response", which only makes sense for plain-text APIs.
 */
export function renderAnswer(template: string, data: unknown): string {
  if (!template.trim()) return typeof data === 'string' ? data.trim() : ''
  return template.replace(ANSWER_SLOT, (_, path: string) => show(readPath(data, path))).trim()
}

/**
 * Problems an admin can fix in the form. The URL's reachability is checked
 * separately (it needs DNS), so only its shape is looked at here.
 */
export function checkAiConfig(cfg: AiEndpointConfig): string | null {
  const probe = fill(cfg.url.trim(), { pertanyaan: 'x', nama: 'x', nomor: 'x' })
  try {
    const url = new URL(probe)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'URL harus diawali https://.'
  } catch {
    return 'URL tidak valid.'
  }

  if (cfg.method === 'POST' && cfg.body.trim()) {
    try {
      // Placeholders are escaped into string literals at runtime, so the
      // template must already be valid JSON with them blanked out.
      JSON.parse(cfg.body.replace(REQUEST_SLOT, ''))
    } catch {
      return 'Body bukan JSON yang valid. Tulis {{pertanyaan}} di dalam tanda kutip.'
    }
  }

  const uses = `${cfg.url}\n${cfg.body}\n${cfg.headers}`
  if (!/\{\{\s*pertanyaan\s*\}\}/.test(uses)) {
    return 'Taruh {{pertanyaan}} di URL atau body, supaya pertanyaan pengguna ikut terkirim.'
  }
  for (const [, name] of uses.matchAll(REQUEST_SLOT)) {
    if (!(AI_PLACEHOLDERS as readonly string[]).includes(name!)) {
      return `{{${name}}} tidak dikenal. Yang tersedia: ${AI_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}.`
    }
  }

  if (!Number.isInteger(cfg.timeoutSeconds) || cfg.timeoutSeconds < 1 || cfg.timeoutSeconds > AI_TIMEOUT_MAX) {
    return `Batas waktu harus 1 sampai ${AI_TIMEOUT_MAX} detik.`
  }
  return null
}

export interface AiPreset {
  id: string
  label: string
  hint: string
  config: AiEndpointConfig
}

export const AI_PRESETS: AiPreset[] = [
  {
    id: 'embed-search',
    label: 'AI Embed Search (layanan publik)',
    hint: 'Pencarian dokumen layanan. Tidak butuh API key.',
    config: {
      method: 'GET',
      url: 'https://ai-embed-production.up.railway.app/documents/search?q={{pertanyaan}}',
      headers: '',
      body: '',
      answerTemplate: '{{feedback.short_description}}\n\n{{feedback.long_summary}}',
      timeoutSeconds: 20,
    },
  },
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    hint: 'Ganti ISI_API_KEY dengan API key dari console.anthropic.com.',
    config: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      headers: 'x-api-key: ISI_API_KEY\nanthropic-version: 2023-06-01\nanthropic-beta: server-side-fallback-2026-07-01',
      body: JSON.stringify(
        {
          model: 'claude-opus-5-5',
          max_tokens: 4096,
          // A declined request is re-run on Anthropic's recommended fallback
          // model instead of coming back empty.
          fallbacks: 'default',
          // Chat replies gain little from deep reasoning, and the flow node
          // gives up after at most 30 seconds.
          output_config: { effort: 'low' },
          system:
            'Kamu customer service yang ramah. Jawab dalam bahasa Indonesia, singkat dan jelas, tanpa format Markdown karena jawaban dikirim lewat WhatsApp. Latency-sensitive; begin your visible answer immediately.',
          messages: [{ role: 'user', content: '{{pertanyaan}}' }],
        },
        null,
        2,
      ),
      answerTemplate: '{{content[type=text].text}}',
      timeoutSeconds: 30,
    },
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible (OpenAI, OpenRouter, Groq, dll.)',
    hint: 'Ganti URL, ISI_API_KEY, dan nama model sesuai penyedia.',
    config: {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      headers: 'Authorization: Bearer ISI_API_KEY',
      body: JSON.stringify(
        {
          model: 'ISI_NAMA_MODEL',
          messages: [
            {
              role: 'system',
              content: 'Kamu customer service yang ramah. Jawab dalam bahasa Indonesia, singkat dan jelas, tanpa format Markdown.',
            },
            { role: 'user', content: '{{pertanyaan}}' },
          ],
        },
        null,
        2,
      ),
      answerTemplate: '{{choices.0.message.content}}',
      timeoutSeconds: 30,
    },
  },
  {
    id: 'custom',
    label: 'Kustom',
    hint: 'Isi sendiri sesuai dokumentasi API-nya.',
    config: { method: 'POST', url: '', headers: '', body: '{"question": "{{pertanyaan}}"}', answerTemplate: '', timeoutSeconds: 20 },
  },
]
