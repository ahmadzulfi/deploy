'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { deleteKnowledgeDoc, saveKnowledgeDoc, type KnowledgeFormState } from '@/lib/actions/knowledge'
import { KNOWLEDGE_CATEGORY_MAX, KNOWLEDGE_CONTENT_MAX, KNOWLEDGE_TITLE_MAX } from '@/lib/knowledge-rules'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'
import { Pagination } from '@/components/ui/pagination'
import { IconPencil, IconPlusCircle, IconRefresh, IconSearch, IconTrash } from '@/components/ui/icons'
import {
  dialogDanger,
  dialogPrimary,
  dialogSecondary,
  ghostButton,
  hint,
  input,
  label,
  primaryButton,
  toolbarCard,
} from '@/components/ui/styles'

export interface KnowledgeRow {
  id: number
  category: string
  title: string
  content: string
  created: string
}

interface Filters {
  q: string
  category: string
}

const textarea =
  'w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent'

export function KnowledgeView({
  rows,
  total,
  all,
  page,
  per,
  categories,
  filters,
  canManage,
}: {
  rows: KnowledgeRow[]
  /** Rows matching the filters. */
  total: number
  /** Every document in the service. */
  all: number
  page: number
  per: number
  categories: { name: string; count: number }[]
  filters: Filters
  canManage: boolean
}) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [search, setSearch] = useState(filters.q)
  const [viewing, setViewing] = useState<KnowledgeRow | null>(null)
  const [editing, setEditing] = useState<KnowledgeRow | 'new' | null>(null)
  const [deleting, setDeleting] = useState<KnowledgeRow | null>(null)

  const state = { ...filters, page, per }
  const href = (over: Partial<typeof state>) => {
    const merged = { ...state, ...over }
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(merged)) {
      const skip = v === '' || (k === 'page' && v === 1) || (k === 'per' && v === 25)
      if (!skip) p.set(k, String(v))
    }
    const s = p.toString()
    return s ? `/knowledge?${s}` : '/knowledge'
  }
  const go = (over: Partial<typeof state>) => router.push(href(over))

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

  const filtered = !!(filters.q || filters.category)
  const iconButton = 'flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg'

  return (
    <>
      <div className={cn(toolbarCard, 'flex flex-wrap items-center gap-1.5')}>
        {canManage && (
          <button type="button" onClick={() => setEditing('new')} className={primaryButton}>
            <IconPlusCircle size={15} />
            Tambah dokumen
          </button>
        )}
        <span className="px-2 text-[12px] text-fg-muted">
          {filtered ? `${total} dari ${all} dokumen` : `${all} dokumen`}
        </span>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <select
            value={filters.category}
            onChange={(e) => go({ category: e.target.value, page: 1 })}
            aria-label="Kategori"
            className="h-9 rounded-md border bg-surface px-2 text-[13px] text-fg outline-none focus:border-accent"
          >
            <option value="">Semua kategori</option>
            {categories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => startRefresh(() => router.refresh())}
            disabled={refreshing}
            className={ghostButton}
          >
            <IconRefresh size={15} className={cn(refreshing && 'animate-spin')} />
            Muat ulang
          </button>

          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              go({ q: search.trim(), page: 1 })
            }}
            className="relative w-full sm:w-60"
          >
            <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari judul atau isi"
              aria-label="Cari dokumen"
              className={cn(input, 'pl-9')}
            />
          </form>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-surface">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-[11px] text-fg-muted">
              <th className="w-14 py-2.5 pl-4 font-medium">ID</th>
              <th className="px-2 py-2.5 font-medium">Dokumen</th>
              <th className="px-2 py-2.5 font-medium">Kategori</th>
              <th className="px-2 py-2.5 font-medium">Dibuat</th>
              {canManage && <th className="py-2.5 pr-4 pl-2 text-right font-medium">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="p-10 text-center text-sm text-fg-muted">
                  {filtered
                    ? 'Tidak ada dokumen yang cocok.'
                    : canManage
                      ? 'Belum ada dokumen. Tambahkan SOP pertama supaya AI punya bahan untuk menjawab.'
                      : 'Belum ada dokumen. Admin bisa menambahkannya di sini.'}
                </td>
              </tr>
            )}
            {rows.map((d) => (
              <tr key={d.id} className="border-t align-top first:border-t-0 hover:bg-muted/60">
                <td className="py-2.5 pl-4 font-mono text-[12px] text-fg-muted">{d.id}</td>
                <td className="max-w-xl px-2 py-2.5">
                  <button
                    type="button"
                    onClick={() => setViewing(d)}
                    className="text-left font-medium text-fg hover:text-accent hover:underline"
                  >
                    {d.title}
                  </button>
                  <span className="mt-0.5 line-clamp-2 text-[12px] text-fg-muted">{d.content}</span>
                </td>
                <td className="px-2 py-2.5">
                  <span className="inline-block rounded-full bg-accent-bg px-2 py-0.5 text-[11px] whitespace-nowrap text-fg">
                    {d.category}
                  </span>
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap text-fg-muted">{d.created}</td>
                {canManage && (
                  <td className="py-2.5 pr-4 pl-2">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => setEditing(d)} aria-label={`Ubah ${d.title}`} className={iconButton}>
                        <IconPencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(d)}
                        aria-label={`Hapus ${d.title}`}
                        className={`${iconButton} hover:text-danger`}
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {total > 0 && (
          <Pagination total={total} page={page} per={per} onPer={(n) => go({ per: n, page: 1 })} href={(p) => href({ page: p })} />
        )}
      </div>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.title ?? ''} className="max-w-2xl">
        {viewing && (
          <div className="space-y-3">
            <p className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
              <span className="rounded-full bg-accent-bg px-2 py-0.5 text-fg">{viewing.category}</span>
              <span>ID {viewing.id}</span>
              <span>Dibuat {viewing.created}</span>
            </p>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-fg">{viewing.content}</p>
            {canManage && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(viewing)
                    setViewing(null)
                  }}
                  className={dialogSecondary}
                >
                  Ubah
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Tambah dokumen' : 'Ubah dokumen'}
        description="Satu dokumen sebaiknya satu layanan atau satu topik, supaya AI menemukan yang tepat."
        className="max-w-2xl"
      >
        {editing && (
          <DocForm
            doc={editing === 'new' ? null : editing}
            categories={categories.map((c) => c.name)}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Hapus dokumen?">
        {deleting && <DeleteForm doc={deleting} onClose={() => setDeleting(null)} />}
      </Modal>
    </>
  )
}

function DocForm({ doc, categories, onClose }: { doc: KnowledgeRow | null; categories: string[]; onClose: () => void }) {
  const [state, action] = useActionState<KnowledgeFormState, FormData>(saveKnowledgeDoc, {})
  const [content, setContent] = useState(doc?.content ?? '')
  const listId = useId()

  useEffect(() => {
    if (state.saved) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.saved])

  return (
    <form action={action} className="space-y-4">
      {doc && <input type="hidden" name="id" value={doc.id} />}
      <label className="block">
        <span className={label}>Kategori</span>
        <input
          name="category"
          defaultValue={doc?.category ?? ''}
          list={listId}
          maxLength={KNOWLEDGE_CATEGORY_MAX}
          placeholder="Kependudukan"
          className={input}
        />
        <datalist id={listId}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <span className={hint}>Kosong berarti &quot;Umum&quot;. Pakai nama kategori yang sudah ada supaya rapi.</span>
      </label>
      <label className="block">
        <span className={label}>Judul</span>
        <input
          name="title"
          defaultValue={doc?.title ?? ''}
          required
          maxLength={KNOWLEDGE_TITLE_MAX}
          placeholder="Penerbitan KTP Elektronik Baru Usia 17 Tahun"
          className={input}
        />
      </label>
      <label className="block">
        <span className={label}>Isi</span>
        <textarea
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          maxLength={KNOWLEDGE_CONTENT_MAX}
          rows={10}
          placeholder="Syarat, prosedur, lokasi, biaya, dan lama proses layanan ini."
          className={textarea}
        />
        <span className={cn(hint, 'flex justify-between gap-4')}>
          <span>Tulis syarat dan prosedurnya lengkap; AI hanya tahu apa yang tertulis di sini.</span>
          <span className="shrink-0 tabular-nums">
            {content.length}/{KNOWLEDGE_CONTENT_MAX}
          </span>
        </span>
      </label>

      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className={dialogSecondary}>
          Batal
        </button>
        <Submit editing={!!doc} />
      </div>
    </form>
  )
}

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className={dialogPrimary}>
      {pending ? 'Menyimpan…' : editing ? 'Simpan' : 'Tambah dokumen'}
    </button>
  )
}

function DeleteForm({ doc, onClose }: { doc: KnowledgeRow; onClose: () => void }) {
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  return (
    <div>
      <p className="text-[13px] text-fg">
        <b>{doc.title}</b> dihapus dari basis pengetahuan, dan AI tidak lagi memakainya untuk menjawab. Isinya tetap
        tercatat di log audit.
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
              const res = await deleteKnowledgeDoc(doc.id)
              if (res.error) setError(res.error)
              else onClose()
            })
          }
          className={dialogDanger}
        >
          {pending ? 'Menghapus…' : 'Hapus dokumen'}
        </button>
      </div>
    </div>
  )
}
