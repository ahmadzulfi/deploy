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
        <Body id={message.id} type={message.type} payload={p} />

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

/**
 * Where the browser loads a message's file from. Media sent by link is shown
 * straight from that link; media held by Meta (everything contacts send, and
 * uploads) goes through our route, which adds the channel token.
 */
function mediaSrc(id: string, payload: Record<string, unknown>) {
  return typeof payload.link === 'string' ? payload.link : `/api/media/${id}`
}

function Caption({ payload }: { payload: Record<string, unknown> }) {
  return typeof payload.caption === 'string' && payload.caption ? (
    <div className="mt-1 text-[13px] whitespace-pre-wrap text-fg">{payload.caption}</div>
  ) : null
}

function Body({ id, type, payload }: { id: string; type: string; payload: Record<string, unknown> }) {
  if (type === 'image' || type === 'sticker') {
    return (
      <>
        <a href={mediaSrc(id, payload)} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- per-message media, not a static asset */}
          <img
            src={mediaSrc(id, payload)}
            alt={type === 'sticker' ? 'stiker' : typeof payload.caption === 'string' ? payload.caption : 'gambar'}
            loading="lazy"
            className={cn('rounded-md', type === 'sticker' ? 'size-32 object-contain' : 'max-h-72 max-w-full object-contain')}
          />
        </a>
        <Caption payload={payload} />
      </>
    )
  }

  if (type === 'video') {
    return (
      <>
        <video src={mediaSrc(id, payload)} controls preload="metadata" className="max-h-72 max-w-full rounded-md" />
        <Caption payload={payload} />
      </>
    )
  }

  if (type === 'audio') {
    return <audio src={mediaSrc(id, payload)} controls preload="metadata" className="max-w-full" />
  }

  if (type === 'document') {
    const name = typeof payload.filename === 'string' && payload.filename ? payload.filename : 'dokumen'
    return (
      <>
        <a
          href={mediaSrc(id, payload)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-[12px] text-accent hover:underline"
        >
          <span aria-hidden>📄</span>
          <span className="truncate">{name}</span>
        </a>
        <Caption payload={payload} />
      </>
    )
  }

  if (type === 'location') {
    const lat = Number(payload.latitude)
    const lng = Number(payload.longitude)
    return (
      <a
        href={`https://www.google.com/maps?q=${lat},${lng}`}
        target="_blank"
        rel="noreferrer"
        className="block text-[13px] text-fg hover:underline"
      >
        <span aria-hidden>📍 </span>
        {typeof payload.name === 'string' && payload.name ? payload.name : `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
        {typeof payload.address === 'string' && payload.address && (
          <span className="block text-[11px] text-fg-muted">{payload.address}</span>
        )}
      </a>
    )
  }

  if (type === 'list') {
    const sections = (payload.sections ?? []) as { title: string; rows: { id: string; title: string }[] }[]
    return (
      <>
        <div className="text-[13px] whitespace-pre-wrap text-fg">{String(payload.body ?? '')}</div>
        <div className="mt-1.5 rounded-md bg-surface px-2 py-1 text-center text-[11px] text-accent">
          ☰ {String(payload.buttonText ?? '')}
        </div>
        <ul className="mt-1 space-y-0.5 text-[11px] text-fg-muted">
          {sections.flatMap((s) => s.rows).map((r) => (
            <li key={r.id}>· {r.title}</li>
          ))}
        </ul>
      </>
    )
  }

  if (type === 'cta_url') {
    return (
      <>
        <div className="text-[13px] whitespace-pre-wrap text-fg">{String(payload.body ?? '')}</div>
        <a
          href={String(payload.url ?? '#')}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 block rounded-md bg-surface px-2 py-1 text-center text-[11px] text-accent hover:underline"
        >
          ↗ {String(payload.displayText ?? '')}
        </a>
      </>
    )
  }

  if (type === 'flow') {
    return (
      <>
        <div className="text-[10px] text-fg-muted">formulir</div>
        <div className="text-[13px] whitespace-pre-wrap text-fg">{String(payload.body ?? '')}</div>
        <div className="mt-1.5 rounded-md bg-surface px-2 py-1 text-center text-[11px] text-accent">
          {String(payload.cta ?? '')}
        </div>
      </>
    )
  }

  if (type === 'form_reply') {
    const answers = Object.entries((payload.response ?? {}) as Record<string, unknown>)
    return (
      <>
        <div className="text-[10px] text-fg-muted">mengisi formulir</div>
        <dl className="mt-0.5 space-y-0.5 text-[12px]">
          {answers.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="shrink-0 font-mono text-[10px] text-fg-muted">{k}</dt>
              <dd className="min-w-0 break-words text-fg">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
      </>
    )
  }

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
    // Sends from the inbox store the rendered text; older ones and flow sends
    // only have the name.
    const preview = payload.preview as { header?: string; body?: string; footer?: string; buttons?: string[] } | undefined
    return (
      <>
        <div className="text-[10px] text-fg-muted">
          template <span className="font-mono">{String(payload.name ?? '')}</span>
        </div>
        {preview?.header && <div className="text-[13px] font-medium text-fg">{preview.header}</div>}
        {preview?.body && <div className="text-[13px] whitespace-pre-wrap text-fg">{preview.body}</div>}
        {preview?.footer && <div className="mt-0.5 text-[11px] text-fg-muted">{preview.footer}</div>}
        {preview?.buttons?.length ? (
          <div className="mt-1.5 space-y-1">
            {preview.buttons.map((b, i) => (
              <div key={i} className="rounded-md bg-surface px-2 py-1 text-center text-[11px] text-accent">
                {b}
              </div>
            ))}
          </div>
        ) : null}
      </>
    )
  }

  // Reactions, orders, and anything Meta ships next: name the type rather than show blank.
  return <div className="text-[13px] text-fg-muted italic">[{type}]</div>
}

function botOrAgent(sentBy: string | null) {
  if (!sentBy) return null
  if (sentBy.startsWith('flow:')) return 'bot'
  if (sentBy.startsWith('campaign:')) return 'broadcast'
  if (sentBy.startsWith('api:')) return 'api'
  if (sentBy === 'system') return 'sistem'
  return null
}
