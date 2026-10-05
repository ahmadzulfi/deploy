'use client'

import { useState, useTransition } from 'react'
import { testKnowledgeSearch, type KnowledgeTestResult } from '@/lib/actions/knowledge'
import { cn } from '@/lib/utils'
import { input } from '@/components/ui/styles'

const pct = (n: number) => `${(n * 100).toFixed(1).replace('.', ',')}%`

/** Asks the service the way a resident would, and shows what came back. */
export function KnowledgeTest() {
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<KnowledgeTestResult | null>(null)
  const [pending, start] = useTransition()

  return (
    <section className="rounded-lg border bg-surface p-4">
      <h2 className="text-sm font-medium text-fg">Uji pertanyaan</h2>
      <p className="mt-0.5 text-[11px] text-fg-muted">
        Tanyakan seperti warga bertanya. Hasilnya sama dengan yang diterima node Tanya AI dari layanan ini, termasuk jawaban
        dari cache. Setiap uji memakai kuota Gemini.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => setResult(await testKnowledgeSearch(question)))
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="ktp saya hilang, syaratnya apa?"
          aria-label="Pertanyaan uji"
          className={input}
        />
        <button
          disabled={pending || !question.trim()}
          className="h-9 shrink-0 rounded-md bg-fg px-4 text-sm text-on-fg hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Bertanya…' : 'Tanya'}
        </button>
      </form>

      {result && !result.ok && <p className="mt-3 text-xs text-danger">{result.error}</p>}
      {result?.ok && <Answer result={result} />}
    </section>
  )
}

function Answer({ result }: { result: Extract<KnowledgeTestResult, { ok: true }> }) {
  const a = result.answer
  return (
    <div className="mt-4 space-y-3 border-t pt-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
        <span
          className={cn(
            'rounded-full px-2 py-0.5',
            a.source === 'cache' ? 'bg-warn-bg text-fg' : 'bg-ok-bg text-fg',
          )}
        >
          {a.source === 'cache' ? 'Dari cache' : 'Dijawab baru'}
        </span>
        {a.similarity !== null && <span>Kemiripan terbaik {pct(a.similarity)}</span>}
        <span>{(result.ms / 1000).toFixed(1).replace('.', ',')} detik</span>
      </p>
      {a.matchedQuestion && (
        <p className="text-[11px] text-fg-muted">
          Mirip dengan pertanyaan sebelumnya: <span className="text-fg">“{a.matchedQuestion}”</span>
        </p>
      )}

      {a.service && (
        <p className="text-[13px] font-medium text-fg">
          {a.service}
          {a.category && <span className="font-normal text-fg-muted"> · {a.category}</span>}
        </p>
      )}
      {a.shortDescription && <p className="text-[13px] leading-relaxed text-fg">{a.shortDescription}</p>}
      {a.longSummary && <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-fg-muted">{a.longSummary}</p>}

      {a.sources.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] text-fg-muted">Dokumen yang dipakai</p>
          <ul className="space-y-0.5 text-[12px]">
            {a.sources.map((s) => (
              <li key={s.id} className="flex gap-2">
                <span className="w-12 shrink-0 text-right tabular-nums text-fg-muted">{pct(s.similarity)}</span>
                <span className="text-fg">
                  <span className="font-mono text-fg-muted">#{s.id}</span> {s.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
