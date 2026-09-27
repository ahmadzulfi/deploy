'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  TEMPLATE_LANGUAGES,
  TEMPLATE_LIMITS,
  bodyVariableCount,
  emptyDraft,
  nextVariable,
  normalizeTemplateName,
  previewDraft,
  validateTemplateDraft,
  variablesIn,
  type DraftButton,
  type HeaderFormat,
  type TemplateCategory,
  type TemplateDraft,
  type WaPreview,
} from '@wa/core/template-draft'
import { createTemplate } from '@/lib/actions/templates'
import { cn } from '@/lib/utils'
import { Menu, MenuItem } from '@/components/ui/menu'
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconLink,
  IconPhone,
  IconPlus,
  IconReply,
  IconTrash,
  IconUpload,
} from '@/components/ui/icons'
import { dialogPrimary, dialogSecondary } from '@/components/ui/styles'
import { WaBubble } from './wa-preview'
import { CATEGORY_ICON } from './category-icon'

// ---------- Step 1 content ----------

const CATEGORY_TABS: { id: TemplateCategory; label: string }[] = [
  { id: 'MARKETING', label: 'Marketing' },
  { id: 'UTILITY', label: 'Utility' },
  { id: 'AUTHENTICATION', label: 'Authentication' },
]

const TYPE_OPTIONS: Record<TemplateCategory, { id: string; label: string; desc: string; soon?: boolean }[]> = {
  MARKETING: [
    { id: 'custom', label: 'Kustom', desc: 'Kirim promosi atau pengumuman produk untuk meningkatkan minat dan keterlibatan.' },
    { id: 'catalog', label: 'Katalog', desc: 'Kirim pesan tentang seluruh katalog atau sebagian produk di dalamnya.', soon: true },
    { id: 'flows', label: 'Flows', desc: 'Kirim formulir untuk menjaring minat, membuat janji temu, atau survei.', soon: true },
  ],
  UTILITY: [
    { id: 'custom', label: 'Kustom', desc: 'Kirim info transaksi, status layanan, atau pengingat ke kontak yang sudah berinteraksi.' },
    { id: 'flows', label: 'Flows', desc: 'Kirim formulir untuk konfirmasi, pembaruan data, atau survei layanan.', soon: true },
  ],
  AUTHENTICATION: [
    { id: 'otp', label: 'Kode sekali pakai', desc: 'Kirim kode verifikasi untuk masuk, reset kata sandi, atau konfirmasi transaksi.' },
  ],
}

const SAMPLES: Record<TemplateCategory, { preview: WaPreview; fits: string; parts: string }> = {
  MARKETING: {
    preview: {
      headerMedia: 'image',
      body: 'Halo! Sayur dan buah segar sudah tersedia hari ini.\n\nPakai kode *SEHAT* untuk diskon 10% semua pembelian.',
      buttons: [
        { kind: 'url', text: 'Belanja sekarang' },
        { kind: 'copy', text: 'Salin kode penawaran' },
      ],
    },
    fits: 'Sapaan, promosi, kupon, buletin, pengumuman',
    parts: 'Media, header, isi, footer, tombol',
  },
  UTILITY: {
    preview: {
      header: 'Pesanan dikonfirmasi',
      body: 'Halo Budi, pesanan *#1234* sudah kami terima dan dikirim besok pagi.',
      footer: 'Toko Cimahi',
      buttons: [{ kind: 'url', text: 'Lacak pesanan' }],
    },
    fits: 'Konfirmasi pesanan, pembaruan akun, tagihan, pengingat janji temu',
    parts: 'Media, header, isi, footer, tombol',
  },
  AUTHENTICATION: {
    preview: previewDraft(emptyDraft('AUTHENTICATION')),
    fits: 'Kode verifikasi masuk, reset kata sandi, konfirmasi transaksi',
    parts: 'Saran keamanan, masa berlaku kode, teks tombol',
  },
}

const HEADER_OPTIONS: { id: HeaderFormat; label: string }[] = [
  { id: 'NONE', label: 'Tidak ada' },
  { id: 'TEXT', label: 'Teks' },
  { id: 'IMAGE', label: 'Gambar (JPG/PNG, maks. 5 MB)' },
  { id: 'VIDEO', label: 'Video (MP4, maks. 16 MB)' },
  { id: 'DOCUMENT', label: 'Dokumen (PDF, maks. 10 MB)' },
]

const MEDIA_ACCEPT: Partial<Record<HeaderFormat, string>> = {
  IMAGE: 'image/jpeg,image/png',
  VIDEO: 'video/mp4',
  DOCUMENT: 'application/pdf',
}

const STEPS = ['Siapkan template', 'Ubah template', 'Kirim untuk review']

const field =
  'h-9 w-full rounded-md border bg-surface px-3 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-accent'

// ---------- Wizard ----------

export function TemplateWizard({ wabas }: { wabas: { wabaId: string; label: string }[] }) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [draft, setDraft] = useState<TemplateDraft>(() => emptyDraft('MARKETING'))
  const [wabaId, setWabaId] = useState(wabas[0]?.wabaId ?? '')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [uploadedFor, setUploadedFor] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [serverFields, setServerFields] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, startSubmit] = useTransition()

  const errors = useMemo(() => ({ ...validateTemplateDraft(draft), ...serverFields }), [draft, serverFields])
  const err = (k: string) => (showErrors ? errors[k] : undefined)
  const preview = step === 1 ? SAMPLES[draft.category].preview : previewDraft(draft)

  const update = (patch: Partial<TemplateDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setServerFields({})
  }

  // The object URL of a sample image lives until it is replaced.
  useEffect(() => () => void (mediaUrl && URL.revokeObjectURL(mediaUrl)), [mediaUrl])

  const clearMedia = () => {
    setMediaUrl(null)
    setUploadedFor('')
  }

  const pickCategory = (category: TemplateCategory) => {
    setDraft((d) => ({ ...emptyDraft(category), name: d.name, language: d.language }))
    clearMedia()
    setShowErrors(false)
  }

  const pickWaba = (id: string) => {
    setWabaId(id)
    // A sample handle belongs to the Meta App that uploaded it, which may not
    // be the one behind the other WABA.
    if (draft.header.handle && uploadedFor !== id) {
      update({ header: { ...draft.header, handle: '', fileName: '' } })
      clearMedia()
    }
  }

  const toReview = () => {
    if (Object.keys(errors).length) {
      setShowErrors(true)
      return
    }
    setStep(3)
  }

  const submit = () =>
    startSubmit(async () => {
      setSubmitError('')
      const res = await createTemplate({ draft, wabaId })
      if (res.error) {
        setSubmitError(res.error)
        if (res.fields) {
          setServerFields(res.fields)
          setShowErrors(true)
        }
        return
      }
      router.push('/templates?tab=pending')
    })

  if (wabas.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="rounded-lg border bg-surface p-6 text-center text-sm text-fg-muted">
          Belum ada WABA dengan nomor terhubung. Hubungkan dulu di halaman{' '}
          <Link href="/channels" className="text-accent underline">
            Nomor
          </Link>
          .
        </p>
      </div>
    )
  }

  const kindLabel = draft.kind === 'otp' ? 'Kode sekali pakai' : 'Kustom'
  const CatIcon = CATEGORY_ICON[draft.category]!

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-6">
        <Link href="/templates" className="text-xs text-fg-muted hover:text-fg">
          ← Template
        </Link>

        <div className="mt-3 grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Preview */}
          <aside className="self-start rounded-lg border bg-surface p-3 lg:sticky lg:top-0">
            <h2 className="mb-2 px-1 text-[13px] font-medium text-fg">Pratinjau template</h2>
            <WaBubble preview={preview} mediaUrl={step === 1 ? null : mediaUrl} className="min-h-80" />
            {step === 1 && (
              <dl className="mt-3 space-y-2 px-1 text-[12px]">
                <div>
                  <dt className="font-medium text-fg">Cocok untuk</dt>
                  <dd className="text-fg-muted">{SAMPLES[draft.category].fits}</dd>
                </div>
                <div>
                  <dt className="font-medium text-fg">Bagian yang bisa diubah</dt>
                  <dd className="text-fg-muted">{SAMPLES[draft.category].parts}</dd>
                </div>
              </dl>
            )}
            {step > 1 && (
              <p className="mt-2 px-1 text-[11px] text-fg-muted">Variabel diisi contoh yang kamu tulis; saat kirim diganti data sebenarnya.</p>
            )}
          </aside>

          <div className="min-w-0 space-y-4">
            <Stepper step={step} />

            {step === 1 && (
              <section className="rounded-lg border bg-surface p-5">
                <h2 className="text-[15px] font-medium text-fg">Siapkan template</h2>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Pilih kategori yang paling menggambarkan pesanmu, lalu jenis pesan yang ingin dikirim. Meta bisa
                  memindahkan kategori saat review bila isinya tidak cocok.
                </p>

                <div role="tablist" aria-label="Kategori" className="mt-4 grid grid-cols-3 overflow-hidden rounded-md border border-accent">
                  {CATEGORY_TABS.map((c) => {
                    const Icon = CATEGORY_ICON[c.id]!
                    const active = draft.category === c.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => pickCategory(c.id)}
                        className={cn(
                          'flex h-10 items-center justify-center gap-2 border-l border-accent text-[11px] font-semibold tracking-wide uppercase first:border-l-0',
                          active ? 'bg-accent-bg text-fg' : 'text-fg-muted hover:bg-muted hover:text-fg',
                        )}
                      >
                        <Icon size={15} />
                        <span className="hidden sm:inline">{c.label}</span>
                        <span className="sm:hidden">{c.label.slice(0, 4)}</span>
                      </button>
                    )
                  })}
                </div>

                <div role="radiogroup" aria-label="Jenis template" className="mt-4 space-y-1">
                  {TYPE_OPTIONS[draft.category].map((o) => {
                    const checked = !o.soon && o.id === draft.kind
                    return (
                      <label
                        key={o.id}
                        className={cn(
                          'flex items-start gap-4 rounded-md px-4 py-3',
                          o.soon ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-muted',
                          checked && 'bg-muted',
                        )}
                      >
                        <input
                          type="radio"
                          name="kind"
                          disabled={o.soon}
                          checked={checked}
                          onChange={() => update({ kind: o.id as TemplateDraft['kind'] })}
                          className="mt-1 size-4 accent-accent"
                        />
                        <span>
                          <span className="flex items-center gap-2 text-[13px] text-fg">
                            {o.label}
                            {o.soon && (
                              <span className="rounded-full border px-2 py-px text-[10px] text-fg-muted">Segera</span>
                            )}
                          </span>
                          <span className="block text-[12px] text-fg-muted">{o.desc}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>

                <div className="mt-5 flex justify-end">
                  <button type="button" onClick={() => setStep(2)} className={dialogPrimary}>
                    Lanjut
                  </button>
                </div>
              </section>
            )}

            {step >= 2 && (
              <div className="flex items-center gap-3 rounded-lg border bg-surface p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
                  <CatIcon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate font-mono text-[14px]', draft.name ? 'text-fg' : 'text-fg-muted')}>
                    {draft.name || 'nama_template'}
                  </div>
                  <div className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">
                    {draft.category} · {kindLabel}
                  </div>
                </div>
                <span className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] text-on-accent">
                  {TEMPLATE_LANGUAGES.find((l) => l.code === draft.language)?.label ?? draft.language}
                </span>
              </div>
            )}

            {step === 2 && (
              <>
                <Section title="Nama dan bahasa" subtitle="Nama hanya terlihat olehmu, tidak dikirim ke kontak.">
                  <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
                    <label className="block">
                      <span className="mb-1 block text-xs text-fg">Nama template</span>
                      <div className="relative">
                        <input
                          value={draft.name}
                          onChange={(e) => update({ name: normalizeTemplateName(e.target.value) })}
                          placeholder="promo_akhir_bulan"
                          className={cn(field, 'pr-16 font-mono', err('name') && 'border-danger')}
                        />
                        <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-fg-muted">
                          {draft.name.length}/{TEMPLATE_LIMITS.name}
                        </span>
                      </div>
                      <FieldError msg={err('name')} />
                      <span className="mt-1 block text-[11px] text-fg-muted">Huruf kecil, angka, dan garis bawah.</span>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-fg">Bahasa</span>
                      <select value={draft.language} onChange={(e) => update({ language: e.target.value })} className={field}>
                        {TEMPLATE_LANGUAGES.map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {wabas.length > 1 && (
                    <label className="mt-3 block">
                      <span className="mb-1 block text-xs text-fg">Akun WhatsApp Business</span>
                      <select value={wabaId} onChange={(e) => pickWaba(e.target.value)} className={field}>
                        {wabas.map((w) => (
                          <option key={w.wabaId} value={w.wabaId}>
                            {w.label}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[11px] text-fg-muted">Template hanya bisa dikirim dari nomor di WABA ini.</span>
                    </label>
                  )}
                </Section>

                {draft.kind === 'otp' ? (
                  <OtpFields draft={draft} update={update} err={err} />
                ) : (
                  <CustomFields
                    draft={draft}
                    update={update}
                    err={err}
                    wabaId={wabaId}
                    onUploaded={(url) => {
                      setMediaUrl(url)
                      setUploadedFor(wabaId)
                    }}
                    onClearMedia={clearMedia}
                  />
                )}

                {showErrors && Object.keys(errors).length > 0 && (
                  <p className="rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">
                    Ada {Object.keys(errors).length} isian yang perlu diperbaiki (ditandai merah).
                  </p>
                )}

                <div className="flex justify-between">
                  <button type="button" onClick={() => setStep(1)} className={dialogSecondary}>
                    Kembali
                  </button>
                  <button type="button" onClick={toReview} className={dialogPrimary}>
                    Lanjut
                  </button>
                </div>
              </>
            )}

            {step === 3 && (
              <section className="rounded-lg border bg-surface p-5">
                <h2 className="text-[15px] font-medium text-fg">Kirim untuk review</h2>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Template dikirim ke Meta dan baru bisa dipakai setelah disetujui — biasanya beberapa menit, paling lama
                  24 jam. Statusnya muncul di daftar template dan diperbarui otomatis.
                </p>

                <dl className="mt-4 divide-y rounded-md border text-[13px]">
                  {(
                    [
                      ['Nama', <span key="n" className="font-mono">{draft.name}</span>],
                      ['Kategori', `${draft.category.toLowerCase()} · ${kindLabel.toLowerCase()}`],
                      ['Bahasa', TEMPLATE_LANGUAGES.find((l) => l.code === draft.language)?.label ?? draft.language],
                      ['WABA', wabas.find((w) => w.wabaId === wabaId)?.label ?? wabaId],
                      ...(draft.kind === 'custom'
                        ? ([
                            ['Header', HEADER_OPTIONS.find((h) => h.id === draft.header.format)?.label.split(' (')[0]],
                            ['Variabel', `${bodyVariableCount(draft.body.text)} di isi pesan`],
                            ['Tombol', draft.buttons.length ? `${draft.buttons.length} tombol` : 'tanpa tombol'],
                          ] as [string, React.ReactNode][])
                        : ([
                            ['Masa berlaku', draft.auth.expiryMinutes ? `${draft.auth.expiryMinutes} menit` : 'tidak ditampilkan'],
                          ] as [string, React.ReactNode][])),
                    ] as [string, React.ReactNode][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex gap-4 px-4 py-2.5">
                      <dt className="w-32 shrink-0 text-fg-muted">{k}</dt>
                      <dd className="min-w-0 break-words text-fg">{v}</dd>
                    </div>
                  ))}
                </dl>

                <ul className="mt-4 list-disc space-y-1 pl-5 text-[12px] text-fg-muted">
                  <li>Nama dan bahasa tidak bisa diubah setelah dikirim.</li>
                  <li>Meta bisa mengganti kategori bila isinya lebih cocok ke kategori lain.</li>
                  {draft.category === 'MARKETING' && (
                    <li>Template marketing hanya dikirim ke kontak yang setuju menerima promosi.</li>
                  )}
                </ul>

                {submitError && (
                  <div className="mt-4 rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">
                    {submitError}
                    {Object.keys(serverFields).length > 0 && (
                      <button type="button" onClick={() => setStep(2)} className="ml-2 underline">
                        Ubah template
                      </button>
                    )}
                  </div>
                )}

                <div className="mt-5 flex justify-between">
                  <button type="button" onClick={() => setStep(2)} disabled={submitting} className={dialogSecondary}>
                    Kembali
                  </button>
                  <button type="button" onClick={submit} disabled={submitting} className={dialogPrimary}>
                    {submitting ? 'Mengirim…' : 'Kirim untuk review'}
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Pieces ----------

type Update = (patch: Partial<TemplateDraft>) => void
type Err = (key: string) => string | undefined

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-3 rounded-lg border bg-surface px-4 py-3">
      {STEPS.map((label, i) => {
        const n = i + 1
        const done = n < step
        const current = n === step
        return (
          <li key={label} className={cn('flex min-w-0 items-center gap-2', i < STEPS.length - 1 && 'flex-1')} aria-current={current ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
                done || current ? 'bg-accent text-on-accent' : 'bg-muted text-fg-muted',
              )}
            >
              {done ? <IconCheck size={13} /> : n}
            </span>
            <span className={cn('truncate text-[12px]', current ? 'text-fg' : 'text-fg-muted', !current && 'hidden sm:inline')}>
              {label}
            </span>
            {i < STEPS.length - 1 && <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />}
          </li>
        )
      })}
    </ol>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <details open className="group rounded-lg border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 text-[13px] font-medium text-fg">{title}</span>
        {subtitle && <span className="hidden min-w-0 flex-1 truncate text-[11px] text-fg-muted sm:block">{subtitle}</span>}
        <IconChevronDown size={16} className="ml-auto shrink-0 text-fg-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t px-5 py-4">{children}</div>
    </details>
  )
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-[11px] text-danger">{msg}</p> : null
}

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={cn('text-[11px]', n > max ? 'text-danger' : 'text-fg-muted')}>Karakter: {n}/{max}</span>
}

// ---------- Custom (marketing / utility) ----------

function CustomFields({
  draft,
  update,
  err,
  wabaId,
  onUploaded,
  onClearMedia,
}: {
  draft: TemplateDraft
  update: Update
  err: Err
  wabaId: string
  onUploaded: (objectUrl: string | null) => void
  onClearMedia: () => void
}) {
  const body = useRef<HTMLTextAreaElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const h = draft.header
  const setHeader = (patch: Partial<TemplateDraft['header']>) => update({ header: { ...h, ...patch } })
  const vars = bodyVariableCount(draft.body.text)

  const upload = async (file: File) => {
    setUploading(true)
    setUploadError('')
    try {
      const fd = new FormData()
      fd.set('file', file)
      fd.set('format', h.format)
      fd.set('wabaId', wabaId)
      const res = await fetch('/api/templates/upload', { method: 'POST', body: fd })
      const json = (await res.json().catch(() => ({}))) as { handle?: string; error?: string }
      if (!res.ok || !json.handle) {
        setUploadError(json.error ?? 'Upload gagal.')
        return
      }
      setHeader({ handle: json.handle, fileName: file.name })
      onUploaded(file.type.startsWith('image/') ? URL.createObjectURL(file) : null)
    } catch {
      setUploadError('Upload gagal. Periksa koneksi lalu coba lagi.')
    } finally {
      setUploading(false)
    }
  }

  /** Wraps the selection in WhatsApp's formatting marks. */
  const wrap = (mark: string) => {
    const ta = body.current
    if (!ta) return
    const { selectionStart: s, selectionEnd: e, value } = ta
    const picked = value.slice(s, e) || 'teks'
    update({ body: { ...draft.body, text: value.slice(0, s) + mark + picked + mark + value.slice(e) } })
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(s + mark.length, s + mark.length + picked.length)
    })
  }

  const addVariable = () => {
    const ta = body.current
    const value = draft.body.text
    const at = ta ? ta.selectionEnd : value.length
    const token = `{{${nextVariable(value)}}}`
    update({ body: { ...draft.body, text: value.slice(0, at) + token + value.slice(at) } })
    requestAnimationFrame(() => {
      ta?.focus()
      ta?.setSelectionRange(at + token.length, at + token.length)
    })
  }

  const setExample = (i: number, v: string) => {
    const examples = [...draft.body.examples]
    while (examples.length <= i) examples.push('')
    examples[i] = v
    update({ body: { ...draft.body, examples } })
  }

  const setButton = (i: number, patch: Partial<DraftButton>) =>
    update({ buttons: draft.buttons.map((b, j) => (j === i ? ({ ...b, ...patch } as DraftButton) : b)) })
  const count = (t: DraftButton['type']) => draft.buttons.filter((b) => b.type === t).length
  const full = draft.buttons.length >= TEMPLATE_LIMITS.buttons
  const tool = 'flex size-7 items-center justify-center rounded text-[13px] text-fg-muted hover:bg-muted hover:text-fg'

  return (
    <>
      <Section title="Header" subtitle="Bagian atas pesan: teks tebal, gambar, video, atau dokumen.">
        <label className="block">
          <span className="mb-1 block text-xs text-fg">Jenis header</span>
          <select
            value={h.format}
            onChange={(e) => {
              setHeader({ format: e.target.value as HeaderFormat, handle: '', fileName: '' })
              onClearMedia()
              setUploadError('')
            }}
            className={field}
          >
            {HEADER_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {h.format === 'TEXT' && (
          <div className="mt-3">
            <input
              value={h.text}
              onChange={(e) => setHeader({ text: e.target.value.replace(/[\r\n]/g, '') })}
              placeholder="Pesanan kamu sudah dikirim"
              className={cn(field, err('header') && 'border-danger')}
            />
            <div className="mt-1 flex items-center justify-between">
              <Counter n={h.text.length} max={TEMPLATE_LIMITS.headerText} />
              <button
                type="button"
                disabled={variablesIn(h.text).length > 0}
                onClick={() => setHeader({ text: `${h.text}{{1}}` })}
                className="text-[11px] font-medium text-accent hover:underline disabled:opacity-40 disabled:hover:no-underline"
              >
                + Tambah variabel
              </button>
            </div>
            <FieldError msg={err('header')} />
            {variablesIn(h.text).length > 0 && (
              <label className="mt-2 block">
                <span className="mb-1 block text-[11px] text-fg-muted">Contoh isi {'{{1}}'}</span>
                <input
                  value={h.example}
                  onChange={(e) => setHeader({ example: e.target.value })}
                  placeholder="#INV-1234"
                  className={cn(field, err('headerExample') && 'border-danger')}
                />
                <FieldError msg={err('headerExample')} />
              </label>
            )}
          </div>
        )}

        {MEDIA_ACCEPT[h.format] && (
          <div className="mt-3">
            <label
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-4 py-3 hover:border-accent',
                err('header') && 'border-danger',
                uploading && 'pointer-events-none opacity-60',
              )}
            >
              <IconUpload size={18} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-fg">
                  {uploading ? 'Mengunggah ke Meta…' : h.fileName || 'Pilih contoh file'}
                </span>
                <span className="block text-[11px] text-fg-muted">
                  {h.handle ? 'Terunggah. Klik untuk mengganti.' : 'Dipakai Meta untuk review; saat kirim kamu bisa pakai file lain.'}
                </span>
              </span>
              <input
                type="file"
                accept={MEDIA_ACCEPT[h.format]}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload(f)
                  e.target.value = ''
                }}
              />
            </label>
            {uploadError && <p className="mt-1 text-[11px] text-danger">{uploadError}</p>}
            <FieldError msg={err('header')} />
          </div>
        )}
      </Section>

      <Section title="Isi pesan" subtitle="Pesan utama yang dibaca kontak.">
        <textarea
          ref={body}
          value={draft.body.text}
          onChange={(e) => update({ body: { ...draft.body, text: e.target.value } })}
          rows={6}
          placeholder={'Halo {{1}}, pesanan kamu sudah kami terima dan akan dikirim {{2}}.'}
          className={cn(
            'w-full rounded-md border bg-surface px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-accent',
            err('body') && 'border-danger',
          )}
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <Counter n={draft.body.text.length} max={TEMPLATE_LIMITS.body} />
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={() => wrap('*')} title="Tebal" aria-label="Tebal" className={cn(tool, 'font-bold')}>
              B
            </button>
            <button type="button" onClick={() => wrap('_')} title="Miring" aria-label="Miring" className={cn(tool, 'italic')}>
              I
            </button>
            <button type="button" onClick={() => wrap('~')} title="Coret" aria-label="Coret" className={cn(tool, 'line-through')}>
              S
            </button>
            <button type="button" onClick={() => wrap('```')} title="Monospace" aria-label="Monospace" className={cn(tool, 'font-mono text-[11px]')}>
              {'<>'}
            </button>
            <button type="button" onClick={addVariable} className="ml-1 text-[11px] font-medium text-accent hover:underline">
              + Tambah variabel
            </button>
          </div>
        </div>
        <FieldError msg={err('body')} />

        {vars > 0 && (
          <div className="mt-3 rounded-md bg-muted/60 p-3">
            <p className="mb-2 text-[11px] text-fg-muted">
              Contoh isi variabel — wajib untuk review Meta. Jangan pakai data asli pelanggan.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: vars }, (_, i) => (
                <label key={i} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 font-mono text-[11px] text-fg-muted">{`{{${i + 1}}}`}</span>
                  <input
                    value={draft.body.examples[i] ?? ''}
                    onChange={(e) => setExample(i, e.target.value)}
                    placeholder={i === 0 ? 'Budi' : 'besok'}
                    className={cn(field, 'h-8', err('bodyExamples') && !(draft.body.examples[i] ?? '').trim() && 'border-danger')}
                  />
                </label>
              ))}
            </div>
            <FieldError msg={err('bodyExamples')} />
          </div>
        )}
      </Section>

      <Section title="Footer" subtitle="Teks kecil di bawah pesan, opsional.">
        <input
          value={draft.footer}
          onChange={(e) => update({ footer: e.target.value })}
          placeholder="Balas STOP untuk berhenti berlangganan"
          className={cn(field, err('footer') && 'border-danger')}
        />
        <div className="mt-1">
          <Counter n={draft.footer.length} max={TEMPLATE_LIMITS.footer} />
        </div>
        <FieldError msg={err('footer')} />
      </Section>

      <Section title="Tombol" subtitle="Balasan cepat atau ajakan bertindak, maksimal 10.">
        {draft.buttons.length === 0 && <p className="mb-3 text-[12px] text-fg-muted">Belum ada tombol.</p>}
        <div className="space-y-2">
          {draft.buttons.map((b, i) => (
            <ButtonRow
              key={i}
              button={b}
              error={err(`button.${i}`)}
              onChange={(patch) => setButton(i, patch)}
              onRemove={() => update({ buttons: draft.buttons.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
        <FieldError msg={err('buttons')} />

        <div className="mt-3">
          <Menu
            align="start"
            disabled={full}
            triggerClassName="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] text-fg hover:bg-muted disabled:opacity-40"
            trigger={
              <>
                <IconPlus size={14} /> Tambah tombol <IconChevronDown size={14} />
              </>
            }
          >
            <MenuItem onSelect={() => update({ buttons: [...draft.buttons, { type: 'QUICK_REPLY', text: '' }] })}>
              <IconReply size={15} /> Balasan cepat
            </MenuItem>
            <MenuItem
              disabled={count('URL') >= TEMPLATE_LIMITS.urlButtons}
              onSelect={() => update({ buttons: [...draft.buttons, { type: 'URL', text: '', url: 'https://', example: '' }] })}
            >
              <IconLink size={15} /> Kunjungi situs
            </MenuItem>
            <MenuItem
              disabled={count('PHONE_NUMBER') >= TEMPLATE_LIMITS.phoneButtons}
              onSelect={() => update({ buttons: [...draft.buttons, { type: 'PHONE_NUMBER', text: '', phone: '+62' }] })}
            >
              <IconPhone size={15} /> Telepon
            </MenuItem>
            {draft.category === 'MARKETING' && (
              <MenuItem
                disabled={count('COPY_CODE') >= 1}
                onSelect={() => update({ buttons: [...draft.buttons, { type: 'COPY_CODE', example: '' }] })}
              >
                <IconCopy size={15} /> Salin kode penawaran
              </MenuItem>
            )}
          </Menu>
          <p className="mt-2 text-[11px] text-fg-muted">
            Balasan cepat selalu ditampilkan lebih dulu. Lebih dari 3 tombol dilipat ke &quot;Lihat semua opsi&quot;.
          </p>
        </div>
      </Section>
    </>
  )
}

const BUTTON_TITLE: Record<DraftButton['type'], string> = {
  QUICK_REPLY: 'Balasan cepat',
  URL: 'Kunjungi situs',
  PHONE_NUMBER: 'Telepon',
  COPY_CODE: 'Salin kode penawaran',
}

function ButtonRow({
  button: b,
  error,
  onChange,
  onRemove,
}: {
  button: DraftButton
  error?: string
  onChange: (patch: Partial<DraftButton>) => void
  onRemove: () => void
}) {
  const dynamic = b.type === 'URL' && variablesIn(b.url).length > 0
  return (
    <div className={cn('rounded-md border p-3', error && 'border-danger')}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">{BUTTON_TITLE[b.type]}</span>
        <button type="button" onClick={onRemove} aria-label="Hapus tombol" className="rounded p-1 text-fg-muted hover:bg-danger-bg hover:text-danger">
          <IconTrash size={14} />
        </button>
      </div>

      {b.type === 'COPY_CODE' ? (
        <label className="block">
          <span className="mb-1 block text-[11px] text-fg-muted">Contoh kode penawaran (maks. 15, huruf & angka)</span>
          <input value={b.example} onChange={(e) => onChange({ example: e.target.value })} placeholder="SEHAT10" className={cn(field, 'h-8 font-mono')} />
        </label>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <label className="block">
            <span className="mb-1 block text-[11px] text-fg-muted">
              Teks tombol ({b.text.length}/{TEMPLATE_LIMITS.buttonText})
            </span>
            <input
              value={b.text}
              maxLength={TEMPLATE_LIMITS.buttonText}
              onChange={(e) => onChange({ text: e.target.value })}
              placeholder={b.type === 'QUICK_REPLY' ? 'Ya, saya tertarik' : b.type === 'URL' ? 'Kunjungi situs' : 'Hubungi kami'}
              className={cn(field, 'h-8')}
            />
          </label>
          {b.type === 'URL' && (
            <label className="block">
              <span className="mb-1 flex items-center justify-between text-[11px] text-fg-muted">
                URL
                {!dynamic && (
                  <button type="button" onClick={() => onChange({ url: `${b.url.replace(/\/?$/, '/')}{{1}}` })} className="text-accent hover:underline">
                    + Variabel di akhir
                  </button>
                )}
              </span>
              <input value={b.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://toko.id/promo" className={cn(field, 'h-8 font-mono text-[12px]')} />
            </label>
          )}
          {b.type === 'PHONE_NUMBER' && (
            <label className="block">
              <span className="mb-1 block text-[11px] text-fg-muted">Nomor telepon</span>
              <input value={b.phone} onChange={(e) => onChange({ phone: e.target.value })} inputMode="tel" placeholder="+6281234567890" className={cn(field, 'h-8 font-mono text-[12px]')} />
            </label>
          )}
        </div>
      )}

      {dynamic && b.type === 'URL' && (
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] text-fg-muted">Contoh URL lengkap untuk review</span>
          <input value={b.example} onChange={(e) => onChange({ example: e.target.value })} placeholder="https://toko.id/promo/abc123" className={cn(field, 'h-8 font-mono text-[12px]')} />
        </label>
      )}
      <FieldError msg={error} />
    </div>
  )
}

// ---------- Authentication ----------

function OtpFields({ draft, update, err }: { draft: TemplateDraft; update: Update; err: Err }) {
  const a = draft.auth
  const set = (patch: Partial<TemplateDraft['auth']>) => update({ auth: { ...a, ...patch } })

  return (
    <>
      <Section title="Isi pesan" subtitle="Teks kode verifikasi disusun Meta, kamu memilih pelengkapnya.">
        <label className="flex items-start gap-2 text-[13px] text-fg">
          <input
            type="checkbox"
            checked={a.securityRecommendation}
            onChange={(e) => set({ securityRecommendation: e.target.checked })}
            className="mt-0.5 size-4 accent-accent"
          />
          <span>
            Tambahkan saran keamanan
            <span className="block text-[11px] text-fg-muted">&quot;Demi keamanan, jangan bagikan kode ini.&quot;</span>
          </span>
        </label>

        <label className="mt-4 flex items-start gap-2 text-[13px] text-fg">
          <input
            type="checkbox"
            checked={a.expiryMinutes !== null}
            onChange={(e) => set({ expiryMinutes: e.target.checked ? 10 : null })}
            className="mt-0.5 size-4 accent-accent"
          />
          <span>
            Tampilkan masa berlaku kode
            <span className="block text-[11px] text-fg-muted">Ditampilkan sebagai footer di bawah kode.</span>
          </span>
        </label>
        {a.expiryMinutes !== null && (
          <label className="mt-2 ml-6 flex items-center gap-2 text-[12px] text-fg">
            <input
              type="number"
              min={1}
              max={90}
              value={a.expiryMinutes}
              onChange={(e) => set({ expiryMinutes: Number(e.target.value) || 0 })}
              className={cn(field, 'h-8 w-20', err('auth') && 'border-danger')}
            />
            menit
          </label>
        )}
        <FieldError msg={err('auth')} />
      </Section>

      <Section title="Tombol" subtitle="Satu tombol untuk menyalin kode.">
        <label className="block">
          <span className="mb-1 block text-xs text-fg">
            Teks tombol salin kode ({a.copyText.length}/{TEMPLATE_LIMITS.buttonText})
          </span>
          <input
            value={a.copyText}
            maxLength={TEMPLATE_LIMITS.buttonText}
            onChange={(e) => set({ copyText: e.target.value })}
            className={cn(field, err('copyText') && 'border-danger')}
          />
        </label>
        <FieldError msg={err('copyText')} />
      </Section>
    </>
  )
}
