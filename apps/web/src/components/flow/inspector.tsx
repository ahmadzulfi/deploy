'use client'

import { WA_LIMITS } from '@wa/core/limits'
import { NODE_LABELS, type NodeData } from '@wa/core/flow'
import { cn } from '@/lib/utils'

const input =
  'h-8 w-full rounded-md border bg-surface px-2 text-[12px] outline-none placeholder:text-fg-muted focus:border-accent'
const area =
  'w-full resize-y rounded-md border bg-surface px-2 py-1.5 text-[12px] outline-none placeholder:text-fg-muted focus:border-accent'

export function Inspector({
  nodeId,
  data,
  onChange,
  onDelete,
}: {
  nodeId: string
  data: NodeData
  onChange: (d: NodeData) => void
  onDelete: () => void
}) {
  const set = (patch: Partial<NodeData>) => onChange({ ...data, ...patch } as NodeData)

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-surface">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-[12px] text-fg">{NODE_LABELS[data.kind]}</span>
        <button
          onClick={onDelete}
          className="text-[11px] text-fg-muted hover:text-danger"
          title="Hapus node ini"
        >
          Hapus
        </button>
      </div>

      <div className="space-y-3 p-3">
        <Fields data={data} set={set} />
        <p className="pt-1 font-mono text-[10px] text-fg-muted">id: {nodeId}</p>
      </div>
    </aside>
  )
}

function Fields({ data, set }: { data: NodeData; set: (p: Partial<NodeData>) => void }) {
  switch (data.kind) {
    case 'trigger':
      return (
        <>
          <Field label="Cocokkan saat">
            <select
              className={input}
              value={data.match}
              onChange={(e) => set({ match: e.target.value as typeof data.match })}
            >
              <option value="keyword">Pesan memuat kata kunci</option>
              <option value="exact">Pesan sama persis</option>
              <option value="regex">Cocok regex</option>
              <option value="buttonPayload">Tombol ditekan</option>
              <option value="newConversation">Percakapan baru</option>
              <option value="api">Dipicu lewat API</option>
            </select>
          </Field>

          {['keyword', 'exact', 'regex', 'buttonPayload'].includes(data.match) && (
            <Field
              label={data.match === 'buttonPayload' ? 'ID tombol' : 'Kata kunci'}
              hint="Satu per baris."
            >
              <textarea
                rows={3}
                className={area}
                value={data.values.join('\n')}
                onChange={(e) => set({ values: e.target.value.split('\n') })}
                placeholder={data.match === 'buttonPayload' ? 'btn_yes' : 'halo\nhai\nmenu'}
              />
            </Field>
          )}

          {data.match !== 'newConversation' && data.match !== 'api' && (
            <Check
              label="Bedakan huruf besar-kecil"
              checked={data.caseSensitive}
              onChange={(v) => set({ caseSensitive: v })}
            />
          )}
        </>
      )

    case 'sendText':
      return (
        <Field label="Isi pesan">
          <textarea
            rows={5}
            className={area}
            value={data.body}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="Halo {{contact.name}}, ada yang bisa dibantu?"
          />
          <Counter value={data.body.length} max={WA_LIMITS.text.bodyMax} />
        </Field>
      )

    case 'sendMedia':
      return (
        <>
          <Field label="Jenis media">
            <select
              className={input}
              value={data.media}
              onChange={(e) => set({ media: e.target.value as typeof data.media })}
            >
              <option value="image">Gambar</option>
              <option value="video">Video</option>
              <option value="document">Dokumen</option>
              <option value="audio">Audio</option>
            </select>
          </Field>

          <Field label="Sumber">
            <select
              className={input}
              value={data.source}
              onChange={(e) => set({ source: e.target.value as typeof data.source })}
            >
              <option value="link">URL publik</option>
              <option value="id">Media ID dari Meta</option>
            </select>
          </Field>

          <Field
            label={data.source === 'link' ? 'URL file' : 'Media ID'}
            hint={
              data.source === 'link'
                ? 'Meta yang mengunduh file ini, jadi URL-nya harus https dan bisa diakses publik — localhost tidak bisa.'
                : 'ID dari endpoint upload Meta. Berlaku 30 hari dan tidak butuh hosting publik.'
            }
          >
            <input
              className={cn(input, 'font-mono')}
              value={data.value}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={data.source === 'link' ? 'https://.../banner.jpg' : '1234567890'}
            />
          </Field>

          {data.media === 'document' && (
            <Field label="Nama file" hint="Yang dilihat penerima saat mengunduh.">
              <input
                className={input}
                value={data.filename ?? ''}
                onChange={(e) => set({ filename: e.target.value || undefined })}
                placeholder="brosur.pdf"
              />
            </Field>
          )}

          {data.media !== 'audio' && (
            <Field label="Caption" hint="Teks di bawah media. Boleh memuat {{variabel}}.">
              <textarea
                rows={5}
                className={area}
                value={data.caption}
                onChange={(e) => set({ caption: e.target.value })}
                placeholder="*Selamat datang {{contact.name}}!*"
              />
              <Counter value={data.caption.length} max={WA_LIMITS.interactive.bodyMax} />
            </Field>
          )}
        </>
      )

    case 'sendButtons':
      return (
        <>
          <Field label="Gambar header" hint="Opsional. URL https publik, muncul di atas pesan.">
            <input
              className={cn(input, 'font-mono')}
              value={data.headerImage ?? ''}
              onChange={(e) => set({ headerImage: e.target.value || undefined })}
              placeholder="https://.../banner.jpg"
            />
          </Field>

          <Field label="Isi pesan">
            <textarea
              rows={4}
              className={area}
              value={data.body}
              onChange={(e) => set({ body: e.target.value })}
            />
            <Counter value={data.body.length} max={WA_LIMITS.interactive.bodyMax} />
          </Field>

          <Field label="Footer" hint="Opsional.">
            <input
              className={input}
              value={data.footer ?? ''}
              onChange={(e) => set({ footer: e.target.value || undefined })}
              maxLength={WA_LIMITS.interactive.footerMax}
            />
          </Field>

          <Field label={`Tombol (${data.buttons.length}/${WA_LIMITS.buttons.max})`}>
            <div className="space-y-1.5">
              {data.buttons.map((b, i) => (
                <div key={i} className="rounded-md border p-1.5">
                  <input
                    className={cn(input, 'mb-1 h-7')}
                    value={b.title}
                    placeholder="Teks tombol"
                    onChange={(e) => {
                      const buttons = [...data.buttons]
                      buttons[i] = { ...b, title: e.target.value }
                      set({ buttons })
                    }}
                  />
                  <div className="flex items-center gap-1">
                    <input
                      className={cn(input, 'h-7 font-mono text-[11px]')}
                      value={b.id}
                      placeholder="id"
                      onChange={(e) => {
                        const buttons = [...data.buttons]
                        buttons[i] = { ...b, id: e.target.value }
                        set({ buttons })
                      }}
                    />
                    <button
                      onClick={() => set({ buttons: data.buttons.filter((_, j) => j !== i) })}
                      className="shrink-0 px-1 text-[11px] text-fg-muted hover:text-danger"
                    >
                      ×
                    </button>
                  </div>
                  <Counter value={b.title.length} max={WA_LIMITS.buttons.titleMax} />
                </div>
              ))}
            </div>

            <button
              disabled={data.buttons.length >= WA_LIMITS.buttons.max}
              title={
                data.buttons.length >= WA_LIMITS.buttons.max
                  ? `WhatsApp hanya mengizinkan ${WA_LIMITS.buttons.max} tombol`
                  : undefined
              }
              onClick={() =>
                set({
                  buttons: [
                    ...data.buttons,
                    { id: `btn_${data.buttons.length + 1}`, title: 'Tombol' },
                  ],
                })
              }
              className="mt-1.5 h-7 w-full rounded-md border text-[11px] text-fg-muted hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Tambah tombol
            </button>
          </Field>
        </>
      )

    case 'sendList': {
      const rows = data.sections.reduce((n, s) => n + s.rows.length, 0)
      return (
        <>
          <Field label="Isi pesan">
            <textarea
              rows={3}
              className={area}
              value={data.body}
              onChange={(e) => set({ body: e.target.value })}
            />
            <Counter value={data.body.length} max={WA_LIMITS.interactive.bodyMax} />
          </Field>

          <Field label="Teks tombol pembuka">
            <input
              className={input}
              value={data.buttonText}
              maxLength={WA_LIMITS.list.buttonTextMax}
              onChange={(e) => set({ buttonText: e.target.value })}
            />
          </Field>

          <Field
            label={`Baris (${rows}/${WA_LIMITS.list.totalRowsMax})`}
            hint="Batas dihitung untuk semua seksi, bukan per seksi."
          >
            {data.sections.map((s, si) => (
              <div key={si} className="mb-1.5 rounded-md border p-1.5">
                <input
                  className={cn(input, 'mb-1 h-7')}
                  value={s.title}
                  placeholder="Judul seksi"
                  maxLength={WA_LIMITS.list.sectionTitleMax}
                  onChange={(e) => {
                    const sections = [...data.sections]
                    sections[si] = { ...s, title: e.target.value }
                    set({ sections })
                  }}
                />
                {s.rows.map((r, ri) => (
                  <div key={ri} className="mb-1 flex gap-1">
                    <input
                      className={cn(input, 'h-7')}
                      value={r.title}
                      maxLength={WA_LIMITS.list.rowTitleMax}
                      onChange={(e) => {
                        const sections = [...data.sections]
                        const rowList = [...s.rows]
                        rowList[ri] = { ...r, title: e.target.value }
                        sections[si] = { ...s, rows: rowList }
                        set({ sections })
                      }}
                    />
                    <button
                      onClick={() => {
                        const sections = [...data.sections]
                        sections[si] = { ...s, rows: s.rows.filter((_, j) => j !== ri) }
                        set({ sections })
                      }}
                      className="shrink-0 px-1 text-[11px] text-fg-muted hover:text-danger"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  disabled={rows >= WA_LIMITS.list.totalRowsMax}
                  onClick={() => {
                    const sections = [...data.sections]
                    sections[si] = {
                      ...s,
                      rows: [...s.rows, { id: `row_${rows + 1}`, title: `Pilihan ${rows + 1}` }],
                    }
                    set({ sections })
                  }}
                  className="h-6 w-full rounded border text-[11px] text-fg-muted hover:bg-muted disabled:opacity-40"
                >
                  + Baris
                </button>
              </div>
            ))}
          </Field>
        </>
      )
    }

    case 'sendTemplate':
      return (
        <>
          <Field label="Nama template" hint="Harus sudah disetujui Meta.">
            <input
              className={input}
              value={data.templateName}
              onChange={(e) => set({ templateName: e.target.value })}
              placeholder="konfirmasi_pesanan"
            />
          </Field>
          <Field label="Bahasa">
            <input
              className={input}
              value={data.language}
              onChange={(e) => set({ language: e.target.value })}
            />
          </Field>
          <Field label="Parameter body" hint="Satu per baris, urut. Boleh {{variabel}}.">
            <textarea
              rows={3}
              className={area}
              value={data.bodyParams.join('\n')}
              onChange={(e) => set({ bodyParams: e.target.value.split('\n') })}
            />
          </Field>
        </>
      )

    case 'waitReply':
      return (
        <>
          <Field label="Simpan jawaban ke variabel">
            <input
              className={cn(input, 'font-mono')}
              value={data.saveAs}
              onChange={(e) => set({ saveAs: e.target.value })}
            />
          </Field>
          <Field label="Harapkan">
            <select
              className={input}
              value={data.expect}
              onChange={(e) => set({ expect: e.target.value as typeof data.expect })}
            >
              <option value="any">Apa saja</option>
              <option value="text">Teks</option>
              <option value="number">Angka</option>
              <option value="email">Email</option>
              <option value="phone">Nomor telepon</option>
              <option value="media">Media</option>
              <option value="location">Lokasi</option>
            </select>
          </Field>
          {data.expect !== 'any' && (
            <Field label="Pesan saat salah format">
              <input
                className={input}
                value={data.invalidMessage ?? ''}
                onChange={(e) => set({ invalidMessage: e.target.value || undefined })}
                placeholder="Formatnya belum sesuai, coba lagi ya."
              />
            </Field>
          )}
          <Field label="Coba ulang maksimum">
            <input
              type="number"
              min={0}
              max={5}
              className={input}
              value={data.maxRetries}
              onChange={(e) => set({ maxRetries: Number(e.target.value) })}
            />
          </Field>
          <Field label="Batas tunggu (menit)" hint="Lewat ini, cabang 'tidak dibalas' yang dipakai.">
            <input
              type="number"
              min={1}
              className={input}
              value={data.timeoutMinutes}
              onChange={(e) => set({ timeoutMinutes: Number(e.target.value) })}
            />
          </Field>
        </>
      )

    case 'condition':
      return (
        <>
          <Field label="Variabel">
            <input
              className={cn(input, 'font-mono')}
              value={data.variable}
              onChange={(e) => set({ variable: e.target.value })}
            />
          </Field>
          <Field label="Operator">
            <select
              className={input}
              value={data.operator}
              onChange={(e) => set({ operator: e.target.value as typeof data.operator })}
            >
              <option value="eq">sama dengan</option>
              <option value="neq">tidak sama dengan</option>
              <option value="contains">memuat</option>
              <option value="startsWith">diawali</option>
              <option value="gt">lebih besar dari</option>
              <option value="lt">lebih kecil dari</option>
              <option value="isSet">terisi</option>
              <option value="isEmpty">kosong</option>
            </select>
          </Field>
          {!['isSet', 'isEmpty'].includes(data.operator) && (
            <Field label="Nilai pembanding">
              <input
                className={input}
                value={data.value}
                onChange={(e) => set({ value: e.target.value })}
              />
            </Field>
          )}
        </>
      )

    case 'setVariable':
      return (
        <>
          <Field label="Nama">
            <input
              className={cn(input, 'font-mono')}
              value={data.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Nilai" hint="Boleh memuat {{variabel}} lain.">
            <input
              className={input}
              value={data.value}
              onChange={(e) => set({ value: e.target.value })}
            />
          </Field>
        </>
      )

    case 'delay':
      return (
        <Field
          label="Jeda (detik)"
          hint="Lebih dari 24 jam membuat window tertutup — pakai node Template setelahnya."
        >
          <input
            type="number"
            min={1}
            className={input}
            value={data.seconds}
            onChange={(e) => set({ seconds: Number(e.target.value) })}
          />
        </Field>
      )

    case 'tag':
      return (
        <>
          <Field label="Tindakan">
            <select
              className={input}
              value={data.action}
              onChange={(e) => set({ action: e.target.value as typeof data.action })}
            >
              <option value="add">Tambah tag</option>
              <option value="remove">Hapus tag</option>
            </select>
          </Field>
          <Field label="Tag" hint="Satu per baris.">
            <textarea
              rows={3}
              className={area}
              value={data.tags.join('\n')}
              onChange={(e) => set({ tags: e.target.value.split('\n') })}
            />
          </Field>
        </>
      )

    case 'handover':
      return (
        <Field label="Pesan sebelum dialihkan" hint="Opsional.">
          <textarea
            rows={3}
            className={area}
            value={data.message ?? ''}
            onChange={(e) => set({ message: e.target.value || undefined })}
            placeholder="Sebentar ya, saya sambungkan ke tim kami."
          />
        </Field>
      )

    case 'assign':
      return (
        <Field label="Catatan untuk agen" hint="Opsional.">
          <input
            className={input}
            value={data.note ?? ''}
            onChange={(e) => set({ note: e.target.value || undefined })}
          />
        </Field>
      )

    case 'end':
      return (
        <Field label="Alasan" hint="Hanya untuk catatanmu.">
          <input
            className={input}
            value={data.reason ?? ''}
            onChange={(e) => set({ reason: e.target.value || undefined })}
          />
        </Field>
      )
  }
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-fg">{label}</div>
      {children}
      {hint && <p className="mt-1 text-[10px] leading-4 text-fg-muted">{hint}</p>}
    </div>
  )
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <p className={cn('mt-0.5 text-right text-[10px]', value > max ? 'text-danger' : 'text-fg-muted')}>
      {value}/{max}
    </p>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-fg">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
