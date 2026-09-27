'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { deleteTemplate, syncTemplates } from '@/lib/actions/templates'
import { CATEGORY_LABEL, TEMPLATE_STATUS, TEMPLATE_TABS, type TemplateTab } from '@/lib/template-labels'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'
import { Pagination } from '@/components/ui/pagination'
import { CATEGORY_ICON } from './category-icon'
import {
  IconAlert,
  IconCheckCircle,
  IconClock,
  IconCompass,
  IconInfinity,
  IconPlusCircle,
  IconRefresh,
  IconSearch,
  IconSync,
  IconTrash,
} from '@/components/ui/icons'
import { dialogDanger, dialogSecondary, ghostButton, primaryButton, toolbarCard } from '@/components/ui/styles'

export interface TemplateRow {
  id: string
  name: string
  language: string
  body: string
  category: string
  kind: string
  status: string
  rejectionReason: string | null
  updated: string
  channel: string
}

interface State {
  tab: TemplateTab
  q: string
  category: string
  page: number
  per: number
}

const TAB_ICON: Record<TemplateTab, (p: { size?: number }) => React.ReactNode> = {
  all: IconInfinity,
  pending: IconClock,
  action: IconAlert,
  approved: IconCheckCircle,
}

export function TemplatesView({
  rows,
  total,
  counts,
  state,
  lastSync,
  canSync,
  canCreate,
  canDelete,
}: {
  rows: TemplateRow[]
  total: number
  counts: Record<TemplateTab, number>
  state: State
  lastSync: string | null
  canSync: boolean
  canCreate: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [syncing, startSync] = useTransition()
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState(state.q)
  const [deleting, setDeleting] = useState<TemplateRow | null>(null)

  const href = (over: Partial<State>) => {
    const m = { ...state, ...over }
    const p = new URLSearchParams()
    if (m.tab !== 'all') p.set('tab', m.tab)
    if (m.q) p.set('q', m.q)
    if (m.category) p.set('category', m.category)
    if (m.page > 1) p.set('page', String(m.page))
    if (m.per !== 10) p.set('per', String(m.per))
    const s = p.toString()
    return s ? `/templates?${s}` : '/templates'
  }
  const go = (over: Partial<State>) => router.push(href(over))

  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (search.trim() === state.q) return
    const t = setTimeout(() => go({ q: search.trim(), page: 1 }), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const sync = () =>
    startSync(async () => {
      const res = await syncTemplates()
      if (res.error && !res.message) setNotice({ tone: 'error', text: res.error })
      else setNotice({ tone: res.error ? 'error' : 'ok', text: [res.message, res.error].filter(Boolean).join(' ') })
    })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-h5 text-fg">Template pesan</h1>
            <p className="mt-1 text-xs text-fg-muted">
              Pesan yang sudah disetujui Meta untuk dikirim di luar window 24 jam — broadcast, notifikasi, dan kode
              verifikasi. Status diperbarui otomatis lewat webhook Meta.
            </p>
          </div>
          {lastSync && <span className="text-[11px] text-fg-muted">Terakhir sinkron {lastSync}</span>}
        </div>

        <div className={cn(toolbarCard, 'flex flex-wrap items-center gap-2')}>
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              go({ q: search.trim(), page: 1 })
            }}
            className="relative w-full sm:w-64"
          >
            <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari template"
              aria-label="Cari template"
              className="h-9 w-full rounded-md border bg-surface pr-3 pl-9 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
            />
          </form>
          <select
            value={state.category}
            onChange={(e) => go({ category: e.target.value, page: 1 })}
            aria-label="Kategori"
            className="h-9 w-full rounded-md border bg-surface px-3 text-[13px] text-fg outline-none focus:border-accent sm:w-44"
          >
            <option value="">Semua kategori</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => startRefresh(() => router.refresh())}
              disabled={refreshing}
              className={ghostButton}
            >
              <IconRefresh size={15} className={cn(refreshing && 'animate-spin')} />
              Muat ulang
            </button>
            <button type="button" disabled title="Segera hadir" className={ghostButton}>
              <IconCompass size={15} />
              Pustaka template
            </button>
            {canSync && (
              <button type="button" onClick={sync} disabled={syncing} className={ghostButton} title="Tarik daftar dan status template dari Meta">
                <IconSync size={15} className={cn(syncing && 'animate-spin')} />
                {syncing ? 'Menyinkronkan…' : 'Sinkronkan'}
              </button>
            )}
            {canCreate && (
              <Link href="/templates/new" className={primaryButton}>
                <IconPlusCircle size={15} />
                Buat template
              </Link>
            )}
          </div>
        </div>

        {notice && (
          <p
            role="status"
            className={cn('rounded-md px-3 py-2 text-xs', notice.tone === 'ok' ? 'bg-ok-bg text-ok' : 'bg-danger-bg text-danger')}
          >
            {notice.text}
          </p>
        )}

        <div className="overflow-hidden rounded-lg border bg-surface">
          <div role="tablist" aria-label="Status template" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b px-2">
            {(Object.keys(TEMPLATE_TABS) as TemplateTab[]).map((t) => {
              const Icon = TAB_ICON[t]
              const active = state.tab === t
              return (
                <Link
                  key={t}
                  role="tab"
                  aria-selected={active}
                  href={href({ tab: t, page: 1 })}
                  className={cn(
                    '-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-[11px] font-semibold tracking-wide uppercase',
                    active ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:text-fg',
                  )}
                >
                  <Icon size={15} />
                  {TEMPLATE_TABS[t].label}
                  <span className={cn('rounded-full px-1.5 text-[10px] leading-4', active ? 'bg-accent-bg' : 'bg-muted')}>
                    {counts[t]}
                  </span>
                </Link>
              )
            })}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[11px] text-fg-muted">
                  <th className="py-2.5 pl-4 font-medium">Nama template</th>
                  <th className="px-2 py-2.5 font-medium">Bahasa</th>
                  <th className="px-2 py-2.5 font-medium">Isi</th>
                  <th className="px-2 py-2.5 font-medium">Kategori</th>
                  <th className="px-2 py-2.5 font-medium">Tipe</th>
                  <th className="px-2 py-2.5 font-medium">Status</th>
                  <th className="px-2 py-2.5 font-medium">Terakhir diubah</th>
                  {canDelete && <th className="py-2.5 pr-4 pl-2 text-right font-medium">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-sm text-fg-muted">
                      {state.q || state.category || state.tab !== 'all'
                        ? 'Tidak ada template yang cocok.'
                        : 'Belum ada template. Buat template baru, atau sinkronkan yang sudah ada di Meta.'}
                    </td>
                  </tr>
                )}
                {rows.map((t) => {
                  const cat = CATEGORY_LABEL[t.category] ?? { label: t.category.toLowerCase(), tone: 'bg-muted text-fg-muted' }
                  const CatIcon = CATEGORY_ICON[t.category]
                  const st = TEMPLATE_STATUS[t.status] ?? TEMPLATE_STATUS.PENDING!
                  return (
                    <tr key={t.id} className="border-t align-top first:border-t-0 hover:bg-muted/60">
                      <td className="max-w-56 py-3 pl-4">
                        <div className="truncate font-mono text-[12px] text-fg">{t.name}</div>
                        <Link href={`/templates/${t.id}`} className="text-[11px] text-accent hover:underline">
                          Lihat detail
                        </Link>
                      </td>
                      <td className="px-2 py-3 whitespace-nowrap text-fg-muted">{t.language}</td>
                      <td className="max-w-xs px-2 py-3 text-[12px] text-fg-muted">
                        <span className="line-clamp-2">
                          {t.body || (t.category === 'AUTHENTICATION' ? 'Kode verifikasi sekali pakai' : '—')}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', cat.tone)}>
                          {CatIcon && <CatIcon size={12} />}
                          {cat.label}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-[11px] text-fg-muted uppercase">{t.kind}</td>
                      <td className="px-2 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-fg" title={t.rejectionReason ?? undefined}>
                          <span className={cn('size-2 rounded-full', st.dot)} />
                          {st.label}
                        </span>
                        {t.status === 'REJECTED' && t.rejectionReason && (
                          <div className="mt-0.5 max-w-36 truncate text-[10px] text-danger">{t.rejectionReason.toLowerCase().replaceAll('_', ' ')}</div>
                        )}
                      </td>
                      <td className="px-2 py-3 text-[12px] whitespace-nowrap text-fg-muted">{t.updated}</td>
                      {canDelete && (
                        <td className="py-2 pr-4 pl-2 text-right">
                          <button
                            type="button"
                            onClick={() => setDeleting(t)}
                            aria-label={`Hapus ${t.name}`}
                            className="inline-flex size-8 items-center justify-center rounded-md text-danger hover:bg-danger-bg"
                          >
                            <IconTrash size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            total={total}
            page={state.page}
            per={state.per}
            sizes={[10, 25, 50]}
            onPer={(n) => go({ per: n, page: 1 })}
            href={(p) => href({ page: p })}
          />
        </div>
      </div>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={`Hapus ${deleting?.name ?? ''}?`}>
        {deleting && (
          <DeleteTemplate
            row={deleting}
            onClose={() => setDeleting(null)}
            onDone={() => setNotice({ tone: 'ok', text: `${deleting.name} dihapus.` })}
          />
        )}
      </Modal>
    </div>
  )
}

function DeleteTemplate({ row, onClose, onDone }: { row: TemplateRow; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  return (
    <div>
      <p className="text-[13px] text-fg">
        Template ini dihapus juga di Meta ({row.language}). Nama <span className="font-mono">{row.name}</span> baru bisa
        dipakai lagi setelah 30 hari, dan flow atau broadcast yang memakainya akan gagal mengirim.
      </p>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2 pt-5">
        <button type="button" onClick={onClose} className={dialogSecondary}>
          Batal
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await deleteTemplate(row.id)
              if (res.error) setError(res.error)
              else {
                onDone()
                onClose()
              }
            })
          }
          className={dialogDanger}
        >
          {pending ? 'Menghapus…' : 'Hapus template'}
        </button>
      </div>
    </div>
  )
}
