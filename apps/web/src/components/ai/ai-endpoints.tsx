'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { ROUTE_TIMEOUT_DEFAULT, type AiEndpointKind, type AiPreset } from '@wa/core/ai'
import {
  deleteAiEndpoint,
  saveAiEndpoint,
  testAiEndpoint,
  testRouteEndpoint,
  type AiFormState,
  type AiTestResult,
  type RouteTestResult,
} from '@/lib/actions/ai'
import { cn } from '@/lib/utils'

const KIND_LABELS: Record<AiEndpointKind, string> = {
  ANSWER: 'Jawab pertanyaan',
  ROUTE: 'Arahkan ke menu',
}

export interface AiEndpointRow {
  id: string
  name: string
  kind: AiEndpointKind
  method: 'GET' | 'POST'
  host: string
  /** Empty for anyone who may not edit it. */
  url: string
  body: string
  answerTemplate: string
  timeoutSeconds: number
  headerNames: string[]
  usedIn: string[]
  lastUsedAt: string | null
  /** Set only while the most recent call failed. */
  lastError: string | null
}

const input =
  'mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-fg-muted focus:border-accent'
const area =
  'mt-1 w-full resize-y rounded-md border bg-surface px-3 py-2 font-mono text-[12px] outline-none placeholder:text-fg-muted focus:border-accent'

export function AiEndpoints({
  canManage,
  presets,
  endpoints,
}: {
  canManage: boolean
  presets: AiPreset[]
  endpoints: AiEndpointRow[]
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null)
  const [pending, start] = useTransition()
  const close = () => setEditing(null)

  return (
    <div>
      <div className="overflow-hidden rounded-lg border bg-surface">
        {endpoints.length === 0 && (
          <p className="p-6 text-center text-xs text-fg-muted">
            Belum ada AI tersimpan.{!canManage && ' Minta admin menambahkannya.'}
          </p>
        )}

        {endpoints.map((e, i) => (
          <div key={e.id} className={cn(i > 0 && 'border-t')}>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-fg">{e.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-fg-muted">
                  {KIND_LABELS[e.kind]} ·{' '}
                  <span className="font-mono">
                    {e.method} {e.host}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-fg-muted">
                  {e.usedIn.length ? `Dipakai di flow: ${e.usedIn.join(', ')}` : 'Belum dipakai di flow mana pun'}
                  {e.lastUsedAt && ` · terakhir dipanggil ${e.lastUsedAt}`}
                </p>
                {e.lastError && (
                  <p className="mt-1 truncate text-[11px] text-danger" title={e.lastError}>
                    Gagal terakhir: {e.lastError}
                  </p>
                )}
                {deleteError?.id === e.id && <p className="mt-1 text-[11px] text-danger">{deleteError.message}</p>}
              </div>

              {canManage && (
                <div className="flex shrink-0 items-center gap-1 text-[11px]">
                  <button
                    onClick={() => setEditing(editing === e.id ? null : e.id)}
                    className="rounded-md px-2 py-1 text-fg-muted hover:bg-muted hover:text-fg"
                  >
                    {editing === e.id ? 'Tutup' : 'Coba / ubah'}
                  </button>
                  {confirmDelete === e.id ? (
                    <>
                      <button
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const res = await deleteAiEndpoint(e.id)
                            setConfirmDelete(null)
                            setDeleteError(res.error ? { id: e.id, message: res.error } : null)
                          })
                        }
                        className="rounded-md px-2 py-1 text-danger hover:bg-danger-bg disabled:opacity-50"
                      >
                        Ya, hapus
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="rounded-md px-2 py-1 text-fg-muted hover:bg-muted"
                      >
                        Batal
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(e.id)}
                      className="rounded-md px-2 py-1 text-fg-muted hover:text-danger"
                    >
                      Hapus
                    </button>
                  )}
                </div>
              )}
            </div>

            {editing === e.id && (
              <div className="border-t bg-bg p-4">
                <AiEndpointForm key={e.id} initial={e} presets={presets} onDone={close} />
              </div>
            )}
          </div>
        ))}
      </div>

      {canManage &&
        (editing === 'new' ? (
          <div className="mt-3 rounded-lg border bg-surface p-4">
            <AiEndpointForm presets={presets} onDone={close} />
          </div>
        ) : (
          <button
            onClick={() => setEditing('new')}
            className="mt-3 h-9 rounded-md border bg-surface px-3 text-sm text-fg hover:bg-muted"
          >
            Tambah AI
          </button>
        ))}
    </div>
  )
}

function AiEndpointForm({
  initial,
  presets,
  onDone,
}: {
  initial?: AiEndpointRow
  presets: AiPreset[]
  onDone: () => void
}) {
  const isNew = !initial
  const first = presets[0]!.config

  const [kind, setKind] = useState<AiEndpointKind>(initial?.kind ?? 'ANSWER')
  const isRoute = kind === 'ROUTE'
  const [presetId, setPresetId] = useState(presets[0]!.id)
  const [name, setName] = useState(initial?.name ?? '')
  const [method, setMethod] = useState(initial?.method ?? first.method)
  const [url, setUrl] = useState(initial?.url ?? first.url)
  const [headers, setHeaders] = useState(isNew ? first.headers : '')
  const [clearHeaders, setClearHeaders] = useState(false)
  const [body, setBody] = useState(initial?.body || first.body)
  const [answerTemplate, setAnswerTemplate] = useState(initial?.answerTemplate ?? first.answerTemplate)
  const [timeoutSeconds, setTimeoutSeconds] = useState(initial?.timeoutSeconds ?? first.timeoutSeconds)

  const [question, setQuestion] = useState('')
  const [test, setTest] = useState<AiTestResult | null>(null)
  const [routeTest, setRouteTest] = useState<RouteTestResult | null>(null)
  const [testing, startTest] = useTransition()

  const [state, action] = useActionState<AiFormState, FormData>(saveAiEndpoint, {})
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.saved) onDone()
  }, [state, onDone])

  const applyPreset = (id: string) => {
    const p = presets.find((x) => x.id === id)
    if (!p) return
    setPresetId(id)
    setMethod(p.config.method)
    setUrl(p.config.url)
    setHeaders(p.config.headers)
    setBody(p.config.body)
    setAnswerTemplate(p.config.answerTemplate)
    setTimeoutSeconds(p.config.timeoutSeconds)
    setTest(null)
  }

  // A router's URL, headers and timeout share nothing with the answer
  // presets, so switching kind starts those fields over.
  const chooseKind = (next: AiEndpointKind) => {
    setKind(next)
    setTest(null)
    setRouteTest(null)
    if (next === 'ROUTE') {
      setUrl('')
      setHeaders('')
      setTimeoutSeconds(ROUTE_TIMEOUT_DEFAULT)
    } else {
      applyPreset(presetId)
    }
  }

  const runTest = () =>
    startTest(async () => {
      const data = new FormData(form.current!)
      data.set('question', question)
      if (isRoute) setRouteTest(await testRouteEndpoint(data))
      else setTest(await testAiEndpoint(data))
    })

  const stored = initial?.headerNames ?? []

  return (
    <form ref={form} action={action} className="space-y-3">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="kind" value={kind} />

      {isNew ? (
        <fieldset>
          <legend className="text-xs text-fg">Jenis</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {(['ANSWER', 'ROUTE'] as const).map((k) => (
              <label
                key={k}
                className={cn(
                  'flex cursor-pointer gap-2 rounded-md border bg-surface p-2.5 text-[11px] text-fg-muted',
                  kind === k && 'border-accent',
                )}
              >
                <input type="radio" name="kindChoice" checked={kind === k} onChange={() => chooseKind(k)} className="mt-0.5" />
                <span>
                  <span className="block text-xs text-fg">{KIND_LABELS[k]}</span>
                  {k === 'ANSWER'
                    ? 'Membalas pertanyaan dengan teks. Dipakai node Tanya AI.'
                    : 'Memilih tujuan di menu flow, bot langsung lompat ke jawabannya. Dipakai node Arahkan AI.'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-[11px] text-fg-muted">
          Jenis: <span className="text-fg">{KIND_LABELS[kind]}</span>. Jenis tidak bisa diubah setelah disimpan.
        </p>
      )}

      {isNew && !isRoute && (
        <label className="block">
          <span className="text-xs text-fg">Mulai dari</span>
          <select className={input} value={presetId} onChange={(e) => applyPreset(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-fg-muted">
            {presets.find((p) => p.id === presetId)?.hint}
          </span>
        </label>
      )}

      <label className="block">
        <span className="text-xs text-fg">Nama</span>
        <input
          name="name"
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="AI Layanan Publik"
          className={input}
        />
        <span className="mt-1 block text-[11px] text-fg-muted">
          Nama inilah yang dipilih di node {isRoute ? 'Arahkan AI' : 'Tanya AI'}.
        </span>
      </label>

      <div className="flex gap-3">
        <label className={cn('block w-28 shrink-0', isRoute && 'hidden')}>
          <span className="text-xs text-fg">Metode</span>
          <select
            name="method"
            className={input}
            value={method}
            onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </label>
        <label className="block min-w-0 flex-1">
          <span className="text-xs text-fg">URL</span>
          <input
            name="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={isRoute ? 'https://layanan-ai.contoh.id/route' : 'https://api.contoh.com/chat'}
            className={cn(input, 'font-mono text-[12px]')}
          />
        </label>
      </div>

      {isRoute && (
        <p className="rounded-md bg-muted px-3 py-2 text-[11px] text-fg-muted">
          Dipanggil dengan <code className="font-mono text-fg">POST</code> berisi pertanyaan warga dan daftar tujuan
          dari menu flow, lalu harus menjawab <code className="font-mono text-fg">destination_id</code> dan{' '}
          <code className="font-mono text-fg">score</code> sesuai kontrak <code className="font-mono">/route</code>.
          Body dan format jawaban tidak perlu diatur.
        </p>
      )}

      <label className="block">
        <span className="text-xs text-fg">Header</span>
        <textarea
          name="headers"
          rows={3}
          value={headers}
          onChange={(e) => setHeaders(e.target.value)}
          placeholder={
            stored.length
              ? `Tersimpan: ${stored.join(', ')}. Kosongkan untuk tetap memakai yang lama.`
              : 'Authorization: Bearer ...'
          }
          className={area}
        />
        <span className="mt-1 block text-[11px] text-fg-muted">
          Satu per baris, format <code className="font-mono">Nama: nilai</code>. Disimpan terenkripsi dan tidak
          ditampilkan lagi; isi ulang semuanya kalau mau mengganti.
        </span>
        {stored.length > 0 && (
          <label className="mt-1.5 flex items-center gap-2 text-[11px] text-fg">
            <input
              type="checkbox"
              name="clearHeaders"
              checked={clearHeaders}
              onChange={(e) => setClearHeaders(e.target.checked)}
            />
            Hapus header yang tersimpan
          </label>
        )}
      </label>

      {!isRoute && method === 'POST' && (
        <label className="block">
          <span className="text-xs text-fg">Body (JSON)</span>
          <textarea name="body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} className={area} />
        </label>
      )}

      {!isRoute && (
        <>
          <p className="rounded-md bg-muted px-3 py-2 text-[11px] text-fg-muted">
            Di URL, header, atau body, tulis <code className="font-mono text-fg">{'{{pertanyaan}}'}</code> untuk
            pertanyaan pengguna (wajib). Tersedia juga <code className="font-mono text-fg">{'{{nama}}'}</code> dan{' '}
            <code className="font-mono text-fg">{'{{nomor}}'}</code> kontak. Isinya otomatis di-encode, jadi di body
            cukup tulis di dalam tanda kutip.
          </p>

          <label className="block">
            <span className="text-xs text-fg">Format jawaban</span>
            <textarea
              name="answerTemplate"
              rows={2}
              value={answerTemplate}
              onChange={(e) => setAnswerTemplate(e.target.value)}
              placeholder="{{choices.0.message.content}}"
              className={area}
            />
            <span className="mt-1 block text-[11px] text-fg-muted">
              Teks yang dikirim ke pengguna. Ambil field dari respons dengan{' '}
              <code className="font-mono">{'{{nama.field}}'}</code>, indeks list dengan angka (
              <code className="font-mono">{'{{data.0.judul}}'}</code>), atau saring list dengan{' '}
              <code className="font-mono">{'{{content[type=text].text}}'}</code>. Kosongkan kalau API-nya membalas teks
              biasa. Lihat &ldquo;Respons mentah&rdquo; di hasil uji untuk mencari nama field.
            </span>
          </label>
        </>
      )}

      <label className="block w-40">
        <span className="text-xs text-fg">Batas waktu (detik)</span>
        <input
          name="timeoutSeconds"
          type="number"
          min={1}
          max={30}
          value={timeoutSeconds}
          onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
          className={input}
        />
      </label>

      <div className="rounded-md border bg-surface p-3">
        <span className="text-xs text-fg">Coba dengan isian di atas</span>
        <div className="mt-1 flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runTest()
              }
            }}
            placeholder={isRoute ? 'cara bikin skck' : 'ktp saya hilang, gimana ngurusnya?'}
            className={cn(input, 'mt-0')}
          />
          <button
            type="button"
            disabled={testing || !question.trim()}
            onClick={runTest}
            className="h-9 shrink-0 rounded-md border bg-surface px-3 text-sm text-fg hover:bg-muted disabled:opacity-50"
          >
            {testing ? 'Menunggu…' : 'Coba'}
          </button>
        </div>

        {isRoute && routeTest && <RouteTestView result={routeTest} />}

        {!isRoute && test && (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] text-fg-muted">
              {test.status !== undefined && `HTTP ${test.status}`}
              {test.ms !== undefined && ` · ${(test.ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} detik`}
            </p>
            {test.ok ? (
              <p className="rounded-md bg-ok-bg px-3 py-2 text-[12px] whitespace-pre-wrap text-fg">{test.answer}</p>
            ) : (
              <p className="rounded-md bg-danger-bg px-3 py-2 text-[12px] whitespace-pre-wrap text-danger">
                {test.error}
              </p>
            )}
            {test.raw && (
              <details open={!test.ok}>
                <summary className="cursor-pointer text-[11px] text-fg-muted">Respons mentah</summary>
                <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap text-fg">
                  {test.raw}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>

      {state.error && <p className="text-xs text-danger">{state.error}</p>}

      <div className="flex gap-2">
        <Submit />
        <button
          type="button"
          onClick={onDone}
          className="h-9 rounded-md border bg-surface px-3 text-sm text-fg-muted hover:bg-muted"
        >
          Batal
        </button>
      </div>
    </form>
  )
}

const score = (s: number) => s.toLocaleString('id-ID', { maximumFractionDigits: 2 })

/** Where the router would send the question, by menu path rather than bare id. */
function RouteTestView({ result }: { result: RouteTestResult }) {
  return (
    <div className="mt-3 space-y-2">
      <p className="text-[11px] text-fg-muted">
        {result.catalog && `Diuji dengan ${result.catalog}`}
        {result.ok && ` (${result.count} tujuan)`}
        {result.status !== undefined && ` · HTTP ${result.status}`}
        {result.ms !== undefined && ` · ${(result.ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} detik`}
      </p>
      {!result.ok ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[12px] whitespace-pre-wrap text-danger">{result.error}</p>
      ) : result.pick ? (
        <div className="rounded-md bg-ok-bg px-3 py-2 text-[12px] text-fg">
          <p>
            Diarahkan ke <span className="font-medium">{result.pick.path ?? result.pick.id}</span> · skor{' '}
            {score(result.pick.score)}
          </p>
          {!result.pick.path && (
            <p className="mt-1 text-danger">ID &ldquo;{result.pick.id}&rdquo; tidak ada di menu, jadi bot akan mengirim menu utama.</p>
          )}
        </div>
      ) : (
        <p className="rounded-md bg-muted px-3 py-2 text-[12px] text-fg">
          AI tidak memilih tujuan (skor {score(result.score)}). Warga akan mendapat menu utama.
        </p>
      )}
      {result.ok && result.candidates.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-fg-muted">
          {result.candidates.map((c) => (
            <li key={c.id}>
              {score(c.score)} · {c.path ?? `${c.id} (tidak ada di menu)`}
            </li>
          ))}
        </ul>
      )}
      {result.raw && (
        <details open={!result.ok}>
          <summary className="cursor-pointer text-[11px] text-fg-muted">Respons mentah</summary>
          <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap text-fg">
            {result.raw}
          </pre>
        </details>
      )}
    </div>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className="h-9 rounded-md bg-fg px-3 text-sm text-on-fg hover:opacity-90 disabled:opacity-50">
      {pending ? 'Menyimpan…' : 'Simpan'}
    </button>
  )
}
