'use client'

import { useState, useTransition } from 'react'
import { rejectRouteDecision } from '@/lib/actions/route-review'
import { Modal } from '@/components/ui/modal'
import type { MenuOption } from '@/lib/route-review'
import { RouteExampleForm } from './route-example-form'

export interface ReviewRow {
  id: string
  when: string
  question: string
  outcome: 'JUMPED' | 'PICKED' | 'OTHER' | 'UNSURE'
  /** Where the contact went, or null when they got the menu. */
  path: string | null
  destinationId: string | null
  score: number
  /** The router's closest destinations, best first. */
  candidates: { id: string; path: string; score: number }[]
}

const OUTCOME: Record<ReviewRow['outcome'], { label: string; className: string }> = {
  JUMPED: { label: 'Langsung diarahkan', className: 'bg-accent-bg text-accent' },
  PICKED: { label: 'Dipilih warga', className: 'bg-ok-bg text-ok' },
  OTHER: { label: 'Pilih Lainnya', className: 'bg-warn-bg text-warn' },
  UNSURE: { label: 'Ke menu utama', className: 'bg-muted text-fg-muted' },
}

const score = (s: number) => s.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function RouteReviewTable({
  rows,
  flowId,
  menu,
  empty,
}: {
  rows: ReviewRow[]
  flowId: string
  menu: MenuOption[]
  empty: string
}) {
  const [approving, setApproving] = useState<ReviewRow | null>(null)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)

  const reject = (id: string) => {
    setBusy(id)
    setError('')
    start(async () => {
      const res = await rejectRouteDecision(id)
      if (res.error) setError(res.error)
      setBusy(null)
    })
  }

  return (
    <>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="overflow-x-auto rounded-lg border bg-surface">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-[11px] text-fg-muted">
              <th className="py-2.5 pl-4 font-medium">Pertanyaan warga</th>
              <th className="px-2 py-2.5 font-medium">Hasil</th>
              <th className="py-2.5 pr-4 pl-2 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="p-10 text-center text-sm text-fg-muted">
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t align-top first:border-t-0 hover:bg-muted/60">
                <td className="max-w-80 py-2.5 pl-4">
                  <p className="text-fg break-words">&ldquo;{r.question}&rdquo;</p>
                  <p className="mt-0.5 text-[11px] text-fg-muted">{r.when}</p>
                </td>
                <td className="px-2 py-2.5">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${OUTCOME[r.outcome].className}`}>
                    {OUTCOME[r.outcome].label}
                  </span>
                  {r.path && (
                    <p className="mt-1 text-fg">
                      {r.path} <span className="text-[11px] text-fg-muted">· skor {score(r.score)}</span>
                    </p>
                  )}
                  {r.candidates.length > 0 && (
                    <details className="mt-1 text-[11px] text-fg-muted">
                      <summary className="cursor-pointer">Kandidat AI ({r.candidates.length})</summary>
                      <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                        {r.candidates.map((c) => (
                          <li key={c.id}>
                            {c.path} · {score(c.score)}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </td>
                <td className="py-2.5 pr-4 pl-2">
                  <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setApproving(r)}
                      className="h-7 rounded-md border border-accent px-2 text-[11px] text-accent hover:bg-accent-bg"
                    >
                      Jadikan contoh
                    </button>
                    <button
                      type="button"
                      disabled={pending && busy === r.id}
                      onClick={() => reject(r.id)}
                      className="h-7 rounded-md px-2 text-[11px] text-fg-muted hover:bg-muted hover:text-danger disabled:opacity-40"
                    >
                      {pending && busy === r.id ? 'Menolak…' : 'Tolak'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={approving !== null}
        onClose={() => setApproving(null)}
        title="Jadikan contoh"
        description="Pertanyaan yang mirip dengan ini nanti langsung diarahkan ke tujuan yang dipilih, tanpa tanya balik."
      >
        {approving && (
          <RouteExampleForm
            flowId={flowId}
            menu={menu}
            decisionId={approving.id}
            question={approving.question}
            destinationId={approving.destinationId ?? approving.candidates[0]?.id ?? ''}
            onClose={() => setApproving(null)}
          />
        )}
      </Modal>
    </>
  )
}
