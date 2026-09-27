/**
 * Shown the instant a conversation is clicked, while the thread is fetched.
 * Mirrors the page's frame (header, message area, composer) so nothing jumps
 * when the real content lands.
 */
export default function ThreadLoading() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <header className="flex h-14 shrink-0 items-center border-b bg-surface px-4">
        <div className="space-y-1.5">
          <div className="h-3.5 w-36 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-52 animate-pulse rounded bg-muted" />
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-hidden bg-bg p-4">
        {['w-2/5', 'ml-auto w-1/3', 'w-1/2', 'ml-auto w-1/4', 'w-1/3'].map((w, i) => (
          <div key={i} className={`h-10 animate-pulse rounded-lg bg-muted ${w}`} />
        ))}
      </div>

      <div className="shrink-0 border-t bg-surface p-3">
        <div className="h-10 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  )
}
