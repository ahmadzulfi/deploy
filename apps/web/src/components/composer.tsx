'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { sendReply, type SendState } from '@/lib/actions/messages'
import { WA_LIMITS } from '@wa/core/limits'

export function Composer({
  conversationId,
  windowOpen,
  readOnly,
  channelPaused,
}: {
  conversationId: string
  windowOpen: boolean
  readOnly: boolean
  channelPaused: boolean
}) {
  const [state, action] = useActionState<SendState, FormData>(sendReply, {})
  const formRef = useRef<HTMLFormElement>(null)

  const blocked = readOnly
    ? 'Peran kamu hanya bisa membaca.'
    : channelPaused
      ? 'Pengiriman dari nomor ini sedang dijeda.'
      : !windowOpen
        ? 'Window 24 jam tertutup — hanya template yang disetujui bisa dikirim.'
        : null

  if (blocked) {
    return (
      <div className="shrink-0 border-t bg-surface p-3">
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-fg-muted">{blocked}</p>
      </div>
    )
  }

  return (
    <form ref={formRef} action={action} className="shrink-0 border-t bg-surface p-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      <Field formRef={formRef} />
      {state.error && <p className="mt-1.5 text-xs text-danger">{state.error}</p>}
    </form>
  )
}

function Field({ formRef }: { formRef: React.RefObject<HTMLFormElement | null> }) {
  const { pending } = useFormStatus()
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!pending) {
      if (ref.current) ref.current.value = ''
      ref.current?.focus()
    }
  }, [pending])

  return (
    <div className="flex items-end gap-2 rounded-lg border px-3 py-2 focus-within:border-accent">
      <textarea
        ref={ref}
        name="body"
        rows={1}
        maxLength={WA_LIMITS.text.bodyMax}
        disabled={pending}
        placeholder="Tulis balasan…"
        className="max-h-32 min-h-5 flex-1 resize-none bg-transparent text-[13px] outline-none placeholder:text-fg-muted disabled:opacity-50"
        onInput={(e) => {
          const el = e.currentTarget
          el.style.height = 'auto'
          el.style.height = `${Math.min(el.scrollHeight, 128)}px`
        }}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line - the convention every
          // chat tool uses, and agents type fast enough to notice its absence.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (e.currentTarget.value.trim()) formRef.current?.requestSubmit()
          }
        }}
      />
      <button
        disabled={pending}
        className="shrink-0 text-xs text-accent hover:opacity-80 disabled:opacity-40"
      >
        {pending ? 'Mengirim…' : 'Kirim'}
      </button>
    </div>
  )
}
