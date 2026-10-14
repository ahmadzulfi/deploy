'use client'

import { useState, useTransition } from 'react'
import { deleteRouteExample } from '@/lib/actions/route-review'
import { Modal } from '@/components/ui/modal'
import { IconPlusCircle, IconTrash } from '@/components/ui/icons'
import { dialogDanger, dialogSecondary, primaryButton, toolbarCard } from '@/components/ui/styles'
import { cn } from '@/lib/utils'
import type { MenuOption } from '@/lib/route-review'
import { RouteExampleForm } from './route-example-form'

export interface ExampleRow {
  id: string
  question: string
  destinationId: string
  by: string | null
  when: string
}

/** Approved examples, grouped under the menu destination they teach. */
export function RouteExamples({
  examples,
  flowId,
  menu,
}: {
  examples: ExampleRow[]
  flowId: string
  menu: MenuOption[]
}) {
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<ExampleRow | null>(null)

  const pathOf = new Map(menu.map((m) => [m.id, m.path]))
  const groups = new Map<string, ExampleRow[]>()
  for (const e of examples) groups.set(e.destinationId, [...(groups.get(e.destinationId) ?? []), e])
  // Live destinations by menu path; examples whose row is gone sink to the end.
  const order = [...groups.keys()].sort((a, b) => {
    const pa = pathOf.get(a)
    const pb = pathOf.get(b)
    if (!pa || !pb) return pa ? -1 : pb ? 1 : a.localeCompare(b)
    return pa.localeCompare(pb, 'id')
  })

  return (
    <>
      <div className={cn(toolbarCard, 'flex flex-wrap items-center gap-2')}>
        <button type="button" onClick={() => setAdding(true)} disabled={menu.length === 0} className={primaryButton}>
          <IconPlusCircle size={15} />
          Tambah contoh
        </button>
        <span className="ml-auto text-[11px] text-fg-muted">
          {examples.length} contoh untuk {groups.size} tujuan
        </span>
      </div>

      {examples.length === 0 && (
        <div className="rounded-lg border bg-surface p-10 text-center text-sm text-fg-muted">
          Belum ada contoh. Setujui pilihan warga di tab Pilihan warga, atau tambahkan sendiri di sini.
        </div>
      )}

      {order.map((id) => {
        const path = pathOf.get(id)
        return (
          <section key={id} className="rounded-lg border bg-surface">
            <header className="border-b px-4 py-2.5">
              <h2 className="text-[13px] text-fg">{path ?? id}</h2>
              {!path && (
                <p className="mt-0.5 text-[11px] text-warn">
                  Tujuan ini sudah tidak ada di menu yang sedang terbit, jadi contohnya tidak dikirim ke AI.
                </p>
              )}
            </header>
            <ul>
              {groups.get(id)!.map((e) => (
                <li key={e.id} className="flex items-start gap-3 border-t px-4 py-2 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] break-words text-fg">&ldquo;{e.question}&rdquo;</p>
                    <p className="text-[11px] text-fg-muted">
                      {e.by ?? 'Admin terhapus'} · {e.when}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleting(e)}
                    aria-label={`Hapus contoh ${e.question}`}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-danger"
                  >
                    <IconTrash size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Tambah contoh"
        description="Tulis pertanyaan seperti yang biasa diketik warga, lalu pilih menu yang menjawabnya."
      >
        {adding && <RouteExampleForm flowId={flowId} menu={menu} onClose={() => setAdding(false)} />}
      </Modal>
      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Hapus contoh ini?">
        {deleting && <DeleteForm example={deleting} onClose={() => setDeleting(null)} />}
      </Modal>
    </>
  )
}

function DeleteForm({ example, onClose }: { example: ExampleRow; onClose: () => void }) {
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  return (
    <div>
      <p className="text-[13px] text-fg">
        &ldquo;{example.question}&rdquo; tidak lagi dipakai AI sebagai contoh. Pertanyaan yang mirip akan kembali dinilai
        dari teks menunya saja.
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
              const res = await deleteRouteExample(example.id)
              if (res.error) setError(res.error)
              else onClose()
            })
          }
          className={dialogDanger}
        >
          {pending ? 'Menghapus…' : 'Hapus contoh'}
        </button>
      </div>
    </div>
  )
}
