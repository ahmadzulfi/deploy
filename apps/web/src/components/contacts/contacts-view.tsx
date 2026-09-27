'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { bulkContacts, type BulkOp } from '@/lib/actions/contacts'
import { OPT_IN_LABEL } from '@/lib/contacts-labels'
import { cn, initials } from '@/lib/utils'
import { Menu, MenuItem, MenuSeparator, useCloseMenu } from '@/components/ui/menu'
import { Pagination } from '@/components/ui/pagination'
import {
  IconChevronDown,
  IconContact,
  IconFilter,
  IconGroup,
  IconPlusCircle,
  IconRefresh,
  IconSearch,
  IconUpload,
} from '@/components/ui/icons'
import { ghostButton, primaryButton, secondaryButton, toolbarCard } from '@/components/ui/styles'
import { AddContactDialog, BulkTagDialog, DeleteContactsDialog, ImportDialog } from './contact-dialogs'
import { CreateGroupDialog, GroupsTable } from './groups-table'

export interface ContactRow {
  id: string
  name: string | null
  waId: string
  tags: string[]
  optInStatus: string
  lastSeen: string
  created: string
}

interface Filters {
  q: string
  tag: string
  status: string
  seen: string
}

type Dialog = 'add' | 'import' | 'addTag' | 'removeTag' | 'delete' | 'createGroup' | null

const STATUS_OPTIONS = [
  { value: '', label: 'Semua status' },
  { value: 'OPTED_IN', label: 'Opt-in' },
  { value: 'UNKNOWN', label: 'Belum jelas' },
  { value: 'OPTED_OUT', label: 'Berhenti' },
]

const SEEN_OPTIONS = [
  { value: '', label: 'Kapan saja' },
  { value: '7', label: '7 hari terakhir' },
  { value: '30', label: '30 hari terakhir' },
  { value: '90', label: '90 hari terakhir' },
  { value: 'never', label: 'Belum pernah chat' },
]

export function ContactsView({
  view,
  rows,
  total,
  page,
  per,
  tags,
  filters,
  canEdit,
  canImport,
  canDelete,
}: {
  view: 'contacts' | 'groups'
  rows: ContactRow[]
  total: number
  page: number
  per: number
  tags: { tag: string; count: number }[]
  filters: Filters
  canEdit: boolean
  canImport: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [busy, startBusy] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<Dialog>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState(filters.q)

  const state = { view, ...filters, per, page }
  const href = (over: Partial<typeof state>) => {
    const merged = { ...state, ...over }
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(merged)) {
      const skip = v === '' || (k === 'view' && v === 'contacts') || (k === 'page' && v === 1) || (k === 'per' && v === 50)
      if (!skip) p.set(k, String(v))
    }
    const s = p.toString()
    return s ? `/contacts?${s}` : '/contacts'
  }
  const go = (over: Partial<typeof state>) => router.push(href(over))

  // A new page of rows means a new selection.
  const rowKey = rows.map((r) => r.id).join()
  useEffect(() => setSelected(new Set()), [rowKey])

  // Typing searches on its own after a pause; Enter searches at once.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (search.trim() === filters.q) return
    const t = setTimeout(() => go({ q: search.trim(), page: 1 }), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const runBulk = (op: BulkOp, value?: string, after?: () => void) =>
    startBusy(async () => {
      const res = await bulkContacts([...selected], op, value)
      if (res.error) setNotice({ tone: 'error', text: res.error })
      else {
        setNotice({ tone: 'ok', text: `${res.done ?? 0} kontak diperbarui.` })
        setSelected(new Set())
        after?.()
      }
    })

  const activeFilters = [filters.tag, filters.status, filters.seen].filter(Boolean).length
  const selectedRows = rows.filter((r) => selected.has(r.id))
  const allOnPage = rows.length > 0 && selected.size === rows.length
  const groupView = view === 'groups'
  const visibleGroups = groupView && filters.q ? tags.filter((t) => t.tag.toLowerCase().includes(filters.q.toLowerCase())) : tags

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <div>
          <h1 className="text-h5 text-fg">Kontak</h1>
          <p className="mt-1 text-xs text-fg-muted">
            Semua orang yang pernah berkirim pesan, ditambahkan, atau diimpor ke org ini. Grup dipakai untuk memilih
            penerima broadcast; atribut bisa dipanggil di flow dan template sebagai{' '}
            <code className="font-mono">{'{{contact.nama_atribut}}'}</code>.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className={cn(toolbarCard, 'flex items-center')}>
            <div role="tablist" aria-label="Tampilan" className="flex rounded-md border border-accent-bg p-0.5">
              {(
                [
                  ['contacts', 'Kontak', IconContact],
                  ['groups', 'Grup', IconGroup],
                ] as const
              ).map(([v, labelText, Icon]) => (
                <Link
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  href={v === 'contacts' ? '/contacts' : '/contacts?view=groups'}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded px-3 text-[11px] font-semibold tracking-wide uppercase',
                    view === v ? 'bg-accent-bg text-fg' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  <Icon size={15} />
                  {labelText}
                </Link>
              ))}
            </div>
          </div>

          <div className={cn(toolbarCard, 'flex flex-1 flex-wrap items-center justify-end gap-1.5')}>
            {!groupView && canEdit && (
              <Menu
                disabled={selected.size === 0 || busy}
                triggerClassName={cn(ghostButton, 'border')}
                trigger={
                  <>
                    Aksi{selected.size > 0 && ` (${selected.size})`} <IconChevronDown size={14} />
                  </>
                }
              >
                <MenuItem onSelect={() => setDialog('addTag')}>Tambah ke grup…</MenuItem>
                <MenuItem onSelect={() => setDialog('removeTag')}>Keluarkan dari grup…</MenuItem>
                <MenuSeparator />
                <MenuItem onSelect={() => runBulk('optIn')}>Tandai opt-in</MenuItem>
                <MenuItem onSelect={() => runBulk('optOut')}>Tandai berhenti</MenuItem>
                {canDelete && (
                  <>
                    <MenuSeparator />
                    <MenuItem danger onSelect={() => setDialog('delete')}>
                      Hapus kontak…
                    </MenuItem>
                  </>
                )}
              </Menu>
            )}

            <button
              type="button"
              onClick={() => startRefresh(() => router.refresh())}
              disabled={refreshing}
              className={ghostButton}
            >
              <IconRefresh size={15} className={cn(refreshing && 'animate-spin')} />
              Muat ulang
            </button>

            {!groupView && (
              <Menu
                triggerClassName={ghostButton}
                panelClassName="w-72 p-3"
                trigger={
                  <>
                    <IconFilter size={15} />
                    Filter
                    {activeFilters > 0 && (
                      <span className="ml-0.5 rounded-full bg-accent px-1.5 text-[10px] leading-4 text-on-accent">
                        {activeFilters}
                      </span>
                    )}
                  </>
                }
              >
                <FilterPanel filters={filters} tags={tags} onApply={(f) => go({ ...f, page: 1 })} />
              </Menu>
            )}

            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault()
                go({ q: search.trim(), page: 1 })
              }}
              className="relative w-full sm:w-56"
            >
              <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={groupView ? 'Cari grup' : 'Cari nama atau nomor'}
                aria-label={groupView ? 'Cari grup' : 'Cari kontak'}
                className="h-9 w-full rounded-md border bg-surface pr-3 pl-9 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
              />
            </form>

            {groupView
              ? canImport && (
                  <button type="button" onClick={() => setDialog('createGroup')} className={primaryButton}>
                    <IconPlusCircle size={15} />
                    Buat grup
                  </button>
                )
              : canEdit && (
                  <>
                    {canImport && (
                      <button type="button" onClick={() => setDialog('import')} className={secondaryButton}>
                        <IconUpload size={15} />
                        Impor kontak
                      </button>
                    )}
                    <button type="button" onClick={() => setDialog('add')} className={primaryButton}>
                      <IconPlusCircle size={15} />
                      Tambah kontak
                    </button>
                  </>
                )}
          </div>
        </div>

        {notice && (
          <p
            role="status"
            className={cn(
              'rounded-md px-3 py-2 text-xs',
              notice.tone === 'ok' ? 'bg-ok-bg text-ok' : 'bg-danger-bg text-danger',
            )}
          >
            {notice.text}
          </p>
        )}

        {!groupView && activeFilters > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-fg-muted">Filter:</span>
            {filters.tag && <Chip onClear={() => go({ tag: '', page: 1 })}>Grup: {filters.tag}</Chip>}
            {filters.status && (
              <Chip onClear={() => go({ status: '', page: 1 })}>
                {STATUS_OPTIONS.find((o) => o.value === filters.status)?.label}
              </Chip>
            )}
            {filters.seen && (
              <Chip onClear={() => go({ seen: '', page: 1 })}>
                {SEEN_OPTIONS.find((o) => o.value === filters.seen)?.label}
              </Chip>
            )}
            <button type="button" onClick={() => go({ tag: '', status: '', seen: '', page: 1 })} className="text-accent hover:underline">
              Hapus semua
            </button>
          </div>
        )}

        {groupView ? (
          <GroupsTable groups={visibleGroups} canManage={canImport} searching={!!filters.q} />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b text-left text-[11px] text-fg-muted">
                    {canEdit && (
                      <th className="w-10 py-2.5 pl-4">
                        <SelectAll
                          checked={allOnPage}
                          indeterminate={selected.size > 0 && !allOnPage}
                          disabled={rows.length === 0}
                          onChange={(on) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set())}
                        />
                      </th>
                    )}
                    <th className={cn('py-2.5 pr-2 font-medium', !canEdit && 'pl-4')}>Kontak</th>
                    <th className="hidden px-2 py-2.5 font-medium md:table-cell">Grup</th>
                    <th className="px-2 py-2.5 font-medium">Status</th>
                    <th className="hidden px-2 py-2.5 font-medium sm:table-cell">Terakhir aktif</th>
                    <th className="hidden py-2.5 pr-4 pl-2 font-medium lg:table-cell">Ditambahkan</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-10 text-center text-sm text-fg-muted">
                        {filters.q || activeFilters
                          ? 'Tidak ada kontak yang cocok.'
                          : 'Belum ada kontak. Kontak muncul otomatis saat seseorang mengirim pesan, atau tambahkan dan impor sendiri.'}
                      </td>
                    </tr>
                  )}
                  {rows.map((c) => {
                    const opt = OPT_IN_LABEL[c.optInStatus] ?? OPT_IN_LABEL.UNKNOWN!
                    const checked = selected.has(c.id)
                    return (
                      <tr key={c.id} className={cn('border-t first:border-t-0 hover:bg-muted/60', checked && 'bg-accent-bg/40')}>
                        {canEdit && (
                          <td className="py-2.5 pl-4">
                            <input
                              type="checkbox"
                              checked={checked}
                              aria-label={`Pilih ${c.name || c.waId}`}
                              onChange={(e) => {
                                const next = new Set(selected)
                                if (e.target.checked) next.add(c.id)
                                else next.delete(c.id)
                                setSelected(next)
                              }}
                              className="size-4 accent-accent"
                            />
                          </td>
                        )}
                        <td className={cn('py-2.5 pr-2', !canEdit && 'pl-4')}>
                          <Link href={`/contacts/${c.id}`} className="flex min-w-0 items-center gap-3">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-fg-muted">
                              {initials(c.name, c.waId)}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-fg hover:underline">
                                {c.name || <span className="text-fg-muted">tanpa nama</span>}
                              </span>
                              <span className="block truncate font-mono text-[11px] text-fg-muted">+{c.waId}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="hidden px-2 py-2.5 md:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {c.tags.slice(0, 3).map((t) => (
                              <Link
                                key={t}
                                href={href({ tag: t, page: 1 })}
                                className="rounded bg-muted px-1.5 py-px text-[10px] text-fg-muted hover:text-fg"
                              >
                                {t}
                              </Link>
                            ))}
                            {c.tags.length > 3 && <span className="text-[10px] text-fg-muted">+{c.tags.length - 3}</span>}
                            {c.tags.length === 0 && <span className="text-[11px] text-fg-muted">—</span>}
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <span className={cn('rounded px-1.5 py-px text-[10px] whitespace-nowrap', opt.tone)}>{opt.label}</span>
                        </td>
                        <td className="hidden px-2 py-2.5 text-[12px] text-fg-muted sm:table-cell">{c.lastSeen || '—'}</td>
                        <td className="hidden py-2.5 pr-4 pl-2 text-[12px] text-fg-muted lg:table-cell">{c.created}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <Pagination total={total} page={page} per={per} onPer={(n) => go({ per: n, page: 1 })} href={(p) => href({ page: p })} />
          </div>
        )}
      </div>

      <AddContactDialog
        open={dialog === 'add'}
        tags={tags}
        onClose={() => setDialog(null)}
        onDone={(text) => setNotice({ tone: 'ok', text })}
      />
      <ImportDialog
        open={dialog === 'import'}
        tags={tags}
        onClose={() => setDialog(null)}
        onDone={(text) => setNotice({ tone: 'ok', text })}
      />
      <BulkTagDialog
        mode={dialog === 'removeTag' ? 'remove' : 'add'}
        open={dialog === 'addTag' || dialog === 'removeTag'}
        count={selected.size}
        tags={dialog === 'removeTag' ? [...new Set(selectedRows.flatMap((r) => r.tags))] : tags.map((t) => t.tag)}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={(tag) => runBulk(dialog === 'removeTag' ? 'removeTag' : 'addTag', tag, () => setDialog(null))}
      />
      <DeleteContactsDialog
        open={dialog === 'delete'}
        count={selected.size}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => runBulk('delete', undefined, () => setDialog(null))}
      />
      <CreateGroupDialog
        open={dialog === 'createGroup'}
        onClose={() => setDialog(null)}
        onDone={(text) => setNotice({ tone: 'ok', text })}
      />
    </div>
  )
}

function FilterPanel({
  filters,
  tags,
  onApply,
}: {
  filters: Filters
  tags: { tag: string; count: number }[]
  onApply: (f: { tag: string; status: string; seen: string }) => void
}) {
  const close = useCloseMenu()
  const [f, setF] = useState({ tag: filters.tag, status: filters.status, seen: filters.seen })
  const select = 'mt-1 h-8 w-full rounded-md border bg-surface px-2 text-[12px] text-fg outline-none focus:border-accent'

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onApply(f)
        close()
      }}
      className="space-y-3"
    >
      <label className="block text-[11px] text-fg-muted">
        Status persetujuan
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={select}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[11px] text-fg-muted">
        Grup
        <select value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} className={select}>
          <option value="">Semua grup</option>
          {tags.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.count})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[11px] text-fg-muted">
        Terakhir aktif
        <select value={f.seen} onChange={(e) => setF({ ...f, seen: e.target.value })} className={select}>
          {SEEN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            onApply({ tag: '', status: '', seen: '' })
            close()
          }}
          className="h-8 rounded-md px-3 text-[12px] text-fg-muted hover:bg-muted hover:text-fg"
        >
          Reset
        </button>
        <button className="h-8 rounded-md bg-fg px-3 text-[12px] text-on-fg hover:opacity-90">Terapkan</button>
      </div>
    </form>
  )
}

function Chip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-surface py-0.5 pr-1 pl-2.5 text-fg">
      {children}
      <button type="button" onClick={onClear} aria-label="Hapus filter" className="rounded-full px-1 text-fg-muted hover:bg-muted hover:text-fg">
        ×
      </button>
    </span>
  )
}

function SelectAll({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  disabled: boolean
  onChange: (on: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label="Pilih semua di halaman ini"
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 accent-accent"
    />
  )
}
