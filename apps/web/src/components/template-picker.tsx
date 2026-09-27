'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { renderTemplate, templateSlots, type TemplateSlot } from '@wa/core/templates'
import { sendTemplateReply, type SendState } from '@/lib/actions/messages'
import { syncTemplates } from '@/lib/actions/templates'
import { cn } from '@/lib/utils'

export interface InboxTemplate {
  id: string
  name: string
  language: string
  category: string
  components: unknown
}

const MEDIA_LABEL = { image: 'gambar', video: 'video', document: 'dokumen' } as const

function slotLabel(s: TemplateSlot) {
  if (s.format === 'image' || s.format === 'video' || s.format === 'document') {
    return `Link ${MEDIA_LABEL[s.format]} header`
  }
  if (s.format === 'coupon') return `Kode kupon (tombol ${Number(s.buttonIndex) + 1})`
  if (s.component === 'button') return `Akhiran URL tombol ${Number(s.buttonIndex) + 1}`
  return `${s.component === 'header' ? 'Header' : 'Body'} {{${s.name}}}`
}

export function TemplatePicker({
  conversationId,
  templates,
  onSent,
  onCancel,
}: {
  conversationId: string
  templates: InboxTemplate[]
  onSent?: () => void
  onCancel?: () => void
}) {
  const [state, action] = useActionState<SendState, FormData>(sendTemplateReply, {})
  const [templateId, setTemplateId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [sync, setSync] = useState<{ message?: string; error?: string } | null>(null)
  const [syncing, startSync] = useTransition()

  const template = templates.find((t) => t.id === templateId)
  const slots = template ? templateSlots(template.components) : []
  const preview = template ? renderTemplate(template.components, values) : null

  useEffect(() => {
    if (!state.ok) return
    setTemplateId('')
    setValues({})
    onSent?.()
    // onSent is a fresh closure every render; only a new success should fire it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  const syncButton = (
    <button
      type="button"
      disabled={syncing}
      onClick={() => startSync(async () => setSync(await syncTemplates()))}
      className="text-[11px] text-accent hover:opacity-80 disabled:opacity-40"
    >
      {syncing ? 'Menyinkronkan…' : 'Sinkronkan dari Meta'}
    </button>
  )

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="templateId" value={templateId} />

      <div className="flex items-center gap-2">
        <select
          value={templateId}
          onChange={(e) => {
            setTemplateId(e.target.value)
            setValues({})
          }}
          className="h-8 min-w-0 flex-1 rounded-md border bg-surface px-2 text-[12px] outline-none focus:border-accent"
        >
          <option value="">
            {templates.length ? '— pilih template —' : 'Belum ada template disetujui untuk nomor ini'}
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.language}) · {t.category.toLowerCase()}
            </option>
          ))}
        </select>
        {syncButton}
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-[11px] text-fg-muted hover:text-fg">
            Tutup
          </button>
        )}
      </div>

      {sync?.message && <p className="text-[11px] text-fg-muted">{sync.message}</p>}
      {sync?.error && <p className="text-[11px] text-danger">{sync.error}</p>}

      {template && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            {slots.length === 0 && <p className="text-[11px] text-fg-muted">Template ini tanpa isian.</p>}
            {slots.map((s) => (
              <label key={s.key} className="block">
                <span className="mb-0.5 block text-[11px] text-fg">{slotLabel(s)}</span>
                <input
                  name={`param:${s.key}`}
                  required
                  value={values[s.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
                  placeholder={s.example ?? (s.format === 'text' || s.format === 'coupon' ? '' : 'https://…')}
                  className="h-8 w-full rounded-md border bg-surface px-2 text-[12px] outline-none placeholder:text-fg-muted focus:border-accent"
                />
              </label>
            ))}
          </div>

          {preview && (
            <div className="rounded-lg bg-accent-bg px-3 py-2 text-[12px]">
              {preview.headerMedia && (
                <div className="mb-1 text-fg-muted italic">[{MEDIA_LABEL[preview.headerMedia]}]</div>
              )}
              {preview.header && <div className="mb-1 font-medium text-fg">{preview.header}</div>}
              <div className="whitespace-pre-wrap text-fg">{preview.body}</div>
              {preview.footer && <div className="mt-1 text-[11px] text-fg-muted">{preview.footer}</div>}
              {preview.buttons.map((b, i) => (
                <div key={i} className="mt-1 rounded-md bg-surface px-2 py-1 text-center text-[11px] text-accent">
                  {b}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {state.error && <p className="text-xs text-danger">{state.error}</p>}

      {template && (
        <div className="flex justify-end">
          <SendButton />
        </div>
      )}
    </form>
  )
}

function SendButton() {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending}
      className={cn('rounded-md bg-accent px-3 py-1.5 text-xs text-on-accent hover:opacity-90 disabled:opacity-50')}
    >
      {pending ? 'Mengirim…' : 'Kirim template'}
    </button>
  )
}
