import { cn } from '@/lib/utils'

type Message = {
  id: string
  direction: string
  type: string
  status: string
  payload: unknown
  errorMessage: string | null
  sentBy: string | null
  createdAt: Date
}

const TICK: Record<string, string> = {
  QUEUED: '◌',
  SENT: '✓',
  DELIVERED: '✓✓',
  READ: '✓✓',
  FAILED: '!',
}

export function MessageBubble({ message }: { message: Message }) {
  const out = message.direction === 'OUT'
  const p = (message.payload ?? {}) as Record<string, unknown>
  const failed = message.status === 'FAILED'

  const time = message.createdAt.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[78%] rounded-xl px-3 py-2',
          out ? 'bg-accent-bg' : 'border bg-surface',
          failed && 'border border-danger bg-danger-bg',
          // A button tap is a reply, but it is also the event a flow matches
          // on - worth distinguishing from ordinary text at a glance.
          !out && message.type === 'interactive' && 'border-accent',
        )}
      >
        <Body type={message.type} payload={p} />

        <div
          className={cn(
            'mt-1 flex items-center gap-1.5 text-[10px]',
            out ? 'justify-end text-accent' : 'text-fg-muted',
          )}
        >
          {botOrAgent(message.sentBy) && <span>{botOrAgent(message.sentBy)}</span>}
          <span>{time}</span>
          {out && <span>{TICK[message.status] ?? ''}</span>}
        </div>

        {failed && message.errorMessage && (
          <p className="mt-1 text-[10px] text-danger">{message.errorMessage}</p>
        )}
      </div>
    </div>
  )
}

function Body({ type, payload }: { type: string; payload: Record<string, unknown> }) {
  if (type === 'interactive' || type === 'button') {
    const id = (payload.replyId ?? payload.payload) as string | undefined
    const title = (payload.title ?? payload.text) as string | undefined
    return (
      <>
        <div className="text-[10px] text-fg-muted">menekan tombol</div>
        <div className="text-[13px] text-fg">{title || id}</div>
        {id && <div className="mt-0.5 font-mono text-[10px] text-fg-muted">{id}</div>}
      </>
    )
  }

  if (type === 'buttons') {
    const buttons = (payload.buttons ?? []) as { id: string; title: string }[]
    return (
      <>
        <div className="text-[13px] whitespace-pre-wrap text-fg">{String(payload.body ?? '')}</div>
        <div className="mt-1.5 space-y-1">
          {buttons.map((b) => (
            <div
              key={b.id}
              className="rounded-md bg-surface px-2 py-1 text-center text-[11px] text-accent"
            >
              {b.title}
            </div>
          ))}
        </div>
      </>
    )
  }

  if (type === 'text') {
    return <div className="text-[13px] whitespace-pre-wrap text-fg">{String(payload.body ?? '')}</div>
  }

  if (type === 'template') {
    return (
      <div className="text-[13px] text-fg">
        Template <span className="font-mono text-xs">{String(payload.name ?? '')}</span>
      </div>
    )
  }

  // Media and anything Meta ships next. Rendering attachments properly comes
  // with the media pipeline; until then, name the type rather than show blank.
  return <div className="text-[13px] text-fg-muted italic">[{type}]</div>
}

function botOrAgent(sentBy: string | null) {
  if (!sentBy) return null
  if (sentBy.startsWith('flow:')) return 'bot'
  if (sentBy.startsWith('campaign:')) return 'broadcast'
  if (sentBy === 'system') return 'sistem'
  return null
}
