import Link from 'next/link'
import { cn } from '@/lib/utils'
import { AiTabs, type AiTab } from './ai-tabs'

/** Title, tabs and - when more than one flow routes - which flow is shown. */
export function AiHeader({
  active,
  pending,
  intro,
  flows,
  flowId,
  hrefFor,
}: {
  active: AiTab
  pending?: number
  intro: React.ReactNode
  flows?: { id: string; name: string }[]
  flowId?: string
  hrefFor?: (flowId: string) => string
}) {
  return (
    <>
      <div>
        <h1 className="text-h5 text-fg">AI</h1>
        <p className="mt-1 text-xs text-fg-muted">{intro}</p>
      </div>
      <AiTabs active={active} pending={pending} />
      {flows && flows.length > 1 && hrefFor && (
        <nav aria-label="Pilih flow" className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-fg-muted">Flow:</span>
          {flows.map((f) => (
            <Link
              key={f.id}
              href={hrefFor(f.id)}
              aria-current={f.id === flowId ? 'page' : undefined}
              className={cn(
                'rounded-full border px-2.5 py-1',
                f.id === flowId ? 'border-accent bg-accent-bg text-accent' : 'text-fg-muted hover:text-fg',
              )}
            >
              {f.name}
            </Link>
          ))}
        </nav>
      )}
    </>
  )
}

/** Shown on the review pages to anyone below admin. */
export function AdminOnly() {
  return (
    <div className="rounded-lg border bg-surface p-10 text-center text-sm text-fg-muted">
      Halaman ini berisi pertanyaan warga, jadi hanya admin yang bisa membukanya.
    </div>
  )
}
