import type { PreviewButtonKind, WaPreview } from '@wa/core/template-draft'
import { cn } from '@/lib/utils'
import { IconCopy, IconFile, IconImage, IconLink, IconList, IconPhone, IconReply, IconVideo } from '@/components/ui/icons'

/**
 * WhatsApp's own inline formatting: *tebal*, _miring_, ~coret~, ```kode```.
 * One level deep, like the app renders it in practice.
 */
function formatWa(text: string): React.ReactNode[] {
  return text.split(/(```[\s\S]+?```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g).map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```') && part.length > 6) {
      return (
        <code key={i} className="font-mono text-[12px]">
          {part.slice(3, -3)}
        </code>
      )
    }
    const inner = part.slice(1, -1)
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <strong key={i}>{inner}</strong>
    if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) return <em key={i}>{inner}</em>
    if (part.length > 2 && part.startsWith('~') && part.endsWith('~')) return <s key={i}>{inner}</s>
    return part
  })
}

const BUTTON_ICON: Record<PreviewButtonKind, (p: { size?: number }) => React.ReactNode> = {
  reply: IconReply,
  url: IconLink,
  phone: IconPhone,
  copy: IconCopy,
  flow: IconList,
  other: IconReply,
}

const MEDIA_ICON = { image: IconImage, video: IconVideo, document: IconFile }

/** A template as it lands in the contact's chat. */
export function WaBubble({
  preview,
  mediaUrl,
  time = '09:41',
  className,
}: {
  preview: WaPreview
  /** Local object URL of the uploaded header sample, shown in place of the placeholder. */
  mediaUrl?: string | null
  time?: string
  className?: string
}) {
  // WhatsApp folds more than three buttons behind "see all options".
  const buttons = preview.buttons.length > 3 ? [...preview.buttons.slice(0, 2), { kind: 'flow' as const, text: 'Lihat semua opsi' }] : preview.buttons
  const empty = !preview.body && !preview.header && !preview.headerMedia

  return (
    <div
      className={cn('rounded-lg bg-chat-bg p-3', className)}
      style={{
        backgroundImage: 'radial-gradient(var(--color-chat-pattern) 1.2px, transparent 1.2px)',
        backgroundSize: '14px 14px',
      }}
    >
      <div className="relative max-w-[92%] overflow-hidden rounded-lg rounded-tl-none bg-bubble text-[13px] leading-snug text-fg shadow-sm">
        <div className="p-1.5">
          {preview.headerMedia && (
            <div className="mb-1.5 overflow-hidden rounded-md bg-muted">
              {mediaUrl && preview.headerMedia === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl} alt="" className="aspect-[1.9] w-full object-cover" />
              ) : (
                <div className="flex aspect-[1.9] items-center justify-center text-fg-muted">
                  {(() => {
                    const Icon = MEDIA_ICON[preview.headerMedia]
                    return <Icon size={34} />
                  })()}
                </div>
              )}
            </div>
          )}
          <div className="px-1.5 pb-0.5">
            {preview.header && <div className="mb-1 font-semibold break-words">{preview.header}</div>}
            {empty ? (
              <div className="h-4" />
            ) : (
              <div className="break-words whitespace-pre-wrap">{formatWa(preview.body)}</div>
            )}
            {preview.footer && <div className="mt-1 text-[11px] text-fg-muted">{preview.footer}</div>}
            <div className="mt-0.5 text-right text-[10px] text-fg-muted">{time}</div>
          </div>
        </div>
        {buttons.map((b, i) => {
          const Icon = BUTTON_ICON[b.kind]
          return (
            <div
              key={i}
              className="flex items-center justify-center gap-1.5 border-t border-chat-pattern px-3 py-2 text-[13px] font-medium text-accent"
            >
              <Icon size={15} />
              <span className="truncate">{b.text || 'Tombol'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
