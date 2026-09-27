'use client'

import { useState, useTransition } from 'react'
import { syncTemplates, type SyncState } from '@/lib/actions/templates'

export function TemplateSyncButton() {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<SyncState | null>(null)

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        disabled={pending}
        onClick={() => start(async () => setResult(await syncTemplates()))}
        className="rounded-md border px-2.5 py-1 text-xs text-fg hover:bg-muted disabled:opacity-50"
        title="Tarik daftar template dan statusnya dari Meta"
      >
        {pending ? 'Menyinkronkan…' : 'Sinkronkan dari Meta'}
      </button>
      {result?.message && <span className="text-[11px] text-fg-muted">{result.message}</span>}
      {result?.error && <span className="max-w-sm text-right text-[11px] text-danger">{result.error}</span>}
    </div>
  )
}
