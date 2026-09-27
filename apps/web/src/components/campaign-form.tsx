'use client'

import { useActionState, useMemo, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { renderTemplate, templateSlots } from '@wa/core/templates'
import { countAudience, createCampaign, type CampaignState } from '@/lib/actions/campaigns'
import { cn } from '@/lib/utils'

export interface FormChannel {
  id: string
  name: string
  displayPhone: string | null
  wabaId: string | null
}

export interface FormTemplate {
  id: string
  name: string
  language: string
  category: string
  wabaId: string
  components: unknown
}

const input =
  'mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-fg-muted focus:border-accent'

export function CampaignForm({
  channels,
  templates,
  tags,
}: {
  channels: FormChannel[]
  templates: FormTemplate[]
  tags: { tag: string; count: number }[]
}) {
  const [state, action] = useActionState<CampaignState, FormData>(createCampaign, {})
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '')
  const [templateId, setTemplateId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<string[]>([])
  const [match, setMatch] = useState<'any' | 'all'>('any')
  const [optInOnly, setOptInOnly] = useState(true)
  const [scheduleLocal, setScheduleLocal] = useState('')
  const [count, setCount] = useState<{ total: number; send: number; skipped: number } | null>(null)
  const [counting, startCount] = useTransition()

  const channel = channels.find((c) => c.id === channelId)
  // A number can only send its own WABA's templates.
  const usable = templates.filter((t) => t.wabaId === channel?.wabaId)
  const template = usable.find((t) => t.id === templateId)
  const slots = useMemo(() => (template ? templateSlots(template.components) : []), [template])
  const preview = template ? renderTemplate(template.components, values) : null

  // The browser knows which timezone the time was typed in; the server does not.
  const scheduleIso = scheduleLocal ? new Date(scheduleLocal).toISOString() : ''

  const refreshCount = (next: { tags?: string[]; match?: 'any' | 'all'; optInOnly?: boolean } = {}) =>
    startCount(async () => {
      setCount(
        await countAudience({
          tags: next.tags ?? picked,
          match: next.match ?? match,
          optInOnly: next.optInOnly ?? optInOnly,
        }),
      )
    })

  const toggleTag = (t: string) => {
    const next = picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t]
    setPicked(next)
    refreshCount({ tags: next })
  }

  if (channels.length === 0) {
    return <p className="rounded-lg border bg-surface p-6 text-center text-sm text-fg-muted">Belum ada nomor yang terhubung.</p>
  }

  return (
    <form action={action} className="space-y-5">
      <section className="rounded-lg border bg-surface p-4">
        <label className="block">
          <span className="text-xs text-fg">Nama broadcast</span>
          <input name="name" required placeholder="Pengumuman jadwal posyandu September" className={input} />
          <span className="mt-1 block text-[11px] text-fg-muted">Hanya untuk dikenali di dashboard; tidak dikirim ke kontak.</span>
        </label>

        <label className="mt-3 block">
          <span className="text-xs text-fg">Dikirim dari</span>
          <select
            name="channelId"
            value={channelId}
            onChange={(e) => {
              setChannelId(e.target.value)
              setTemplateId('')
              setValues({})
            }}
            className={input}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.displayPhone ? `(${c.displayPhone})` : ''}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="rounded-lg border bg-surface p-4">
        <label className="block">
          <span className="text-xs text-fg">Template</span>
          <select
            name="templateId"
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value)
              setValues({})
            }}
            className={input}
          >
            <option value="">— pilih template yang disetujui —</option>
            {usable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.language} · {t.category.toLowerCase()}
              </option>
            ))}
          </select>
          {usable.length === 0 && (
            <span className="mt-1 block text-[11px] text-warn">
              Nomor ini belum punya template APPROVED. Buat atau sinkronkan di halaman Template.
            </span>
          )}
        </label>

        {slots.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] text-fg-muted">
              Isian bisa berupa teks tetap atau diambil dari kontak:{' '}
              <code className="font-mono">{'{{contact.name}}'}</code>,{' '}
              <code className="font-mono">{'{{contact.<atribut>}}'}</code>. Kontak yang isiannya jadi kosong
              dicatat gagal, tidak dikirimi pesan setengah jadi.
            </p>
            {slots.map((s) => (
              <label key={s.key} className="block">
                <span className="font-mono text-[11px] text-fg">{s.key}</span>
                <input
                  name={`param:${s.key}`}
                  required
                  value={values[s.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                  placeholder={
                    s.format === 'image' || s.format === 'video' || s.format === 'document'
                      ? `https://… (${s.format})`
                      : s.example ?? (s.component === 'body' ? '{{contact.name}}' : '')
                  }
                  className={input}
                />
              </label>
            ))}
          </div>
        )}

        {preview && (
          <div className="mt-3 rounded-md bg-accent-bg p-3 text-[12px]">
            <div className="mb-1 text-[10px] text-fg-muted">pratinjau (placeholder diisi per kontak saat kirim)</div>
            {preview.header && <div className="font-medium text-fg">{preview.header}</div>}
            {preview.headerMedia && <div className="text-[11px] text-fg-muted">[{preview.headerMedia}]</div>}
            <div className="whitespace-pre-wrap text-fg">{preview.body}</div>
            {preview.footer && <div className="mt-1 text-[11px] text-fg-muted">{preview.footer}</div>}
            {preview.buttons.map((b, i) => (
              <div key={i} className="mt-1 rounded bg-surface px-2 py-1 text-center text-[11px] text-accent">
                {b}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-surface p-4">
        <div className="text-xs text-fg">Penerima</div>
        <p className="mt-0.5 text-[11px] text-fg-muted">
          Tanpa tag = semua kontak. Daftar penerima dikunci saat broadcast mulai; kontak yang diberi tag
          sesudahnya tidak ikut.
        </p>

        {tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button
                type="button"
                key={t.tag}
                onClick={() => toggleTag(t.tag)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-[11px]',
                  picked.includes(t.tag) ? 'border-fg bg-fg text-on-fg' : 'bg-surface text-fg-muted hover:text-fg',
                )}
              >
                {t.tag} <span className="opacity-60">{t.count}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-fg-muted">Belum ada kontak bertag. Beri tag di halaman Kontak.</p>
        )}
        {picked.map((t) => (
          <input key={t} type="hidden" name="tag" value={t} />
        ))}

        {picked.length > 1 && (
          <div className="mt-3 flex gap-4 text-[12px] text-fg">
            {(['any', 'all'] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="match"
                  value={m}
                  checked={match === m}
                  onChange={() => {
                    setMatch(m)
                    refreshCount({ match: m })
                  }}
                />
                {m === 'any' ? 'punya salah satu tag' : 'punya semua tag'}
              </label>
            ))}
          </div>
        )}

        <label className="mt-3 flex items-start gap-2 text-[12px] text-fg">
          <input
            type="checkbox"
            name="optInOnly"
            checked={optInOnly}
            onChange={(e) => {
              setOptInOnly(e.target.checked)
              refreshCount({ optInOnly: e.target.checked })
            }}
            className="mt-0.5"
          />
          <span>
            Hanya kontak yang opt-in
            <span className="block text-[11px] text-fg-muted">
              Kontak yang pernah mengirim pesan duluan, atau ditandai opt-in manual. Kebijakan Meta meminta
              persetujuan sebelum pesan dari bisnis; mematikan ini menaikkan risiko nomor dilaporkan.
            </span>
          </span>
        </label>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => refreshCount()}
            disabled={counting}
            className="h-8 rounded-md border bg-surface px-3 text-xs text-fg hover:bg-muted disabled:opacity-50"
          >
            {counting ? 'Menghitung…' : 'Hitung penerima'}
          </button>
          {count && (
            <span className="text-[12px] text-fg">
              <b>{count.send}</b> akan dikirimi
              {count.skipped > 0 && <span className="text-fg-muted"> · {count.skipped} dilewati</span>}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-fg">Jadwal</span>
            <input
              type="datetime-local"
              value={scheduleLocal}
              onChange={(e) => setScheduleLocal(e.target.value)}
              className={input}
            />
            <input type="hidden" name="scheduleAtIso" value={scheduleIso} />
            <span className="mt-1 block text-[11px] text-fg-muted">Kosongkan untuk mulai begitu ditekan Mulai.</span>
          </label>
          <label className="block">
            <span className="text-xs text-fg">Kecepatan (pesan per menit)</span>
            <input type="number" name="throttlePerMin" min={1} max={1000} defaultValue={60} className={input} />
            <span className="mt-1 block text-[11px] text-fg-muted">
              Pelan lebih aman untuk quality rating nomor; balasan live tetap didahulukan.
            </span>
          </label>
        </div>
      </section>

      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <Submit disabled={!template} />
      <p className="text-[11px] text-fg-muted">
        Menyimpan belum mengirim apa pun. Broadcast baru berjalan setelah ditekan Mulai di halaman berikutnya.
      </p>
    </form>
  )
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending || disabled}
      className="h-9 rounded-md bg-fg px-4 text-sm text-on-fg hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Menyimpan…' : 'Simpan sebagai draf'}
    </button>
  )
}
