import { hasRole, requireUser } from '@/lib/auth'
import { allDocuments, knowledgeHost, type KnowledgeDoc } from '@/lib/knowledge'
import { KnowledgeView, type KnowledgeRow } from '@/components/knowledge/knowledge-view'
import { KnowledgeTest } from '@/components/knowledge/knowledge-test'

export const dynamic = 'force-dynamic'

const PAGE_SIZES = [10, 25, 50, 100]

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; page?: string; per?: string }>
}) {
  const user = await requireUser()
  const sp = await searchParams
  const q = sp.q?.trim() ?? ''
  const category = sp.category?.trim() ?? ''
  const per = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 25
  const page = Math.max(1, Number(sp.page) || 1)
  const canManage = hasRole(user, 'ADMIN')
  const canTest = hasRole(user, 'AGENT')

  const host = knowledgeHost()
  const docs = host ? await allDocuments() : null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <div>
          <h1 className="text-h5 text-fg">Basis Pengetahuan</h1>
          <p className="mt-1 text-xs text-fg-muted">
            Dokumen SOP yang dibaca layanan AI untuk menjawab pertanyaan warga. Node Tanya AI yang diarahkan ke layanan ini
            di halaman AI menjawab dari dokumen-dokumen di sini. Setiap kali disimpan, isi dokumen diubah menjadi embedding
            lewat Gemini, jadi menyimpan butuh beberapa detik.
            {host && (
              <>
                {' '}
                Layanan: <span className="font-mono text-fg">{host}</span>.
              </>
            )}
          </p>
        </div>

        {!host ? (
          <Notice title="Layanan pengetahuan belum diatur">
            Isi <code className="font-mono">AI_KNOWLEDGE_URL</code> (dan <code className="font-mono">AI_KNOWLEDGE_API_KEY</code>{' '}
            kalau layanannya memakai key) di <code className="font-mono">.env</code> root, lalu jalankan ulang dashboard.
            Untuk mencoba tanpa layanan sungguhan: <code className="font-mono">pnpm knowledge:fake</code> lalu isi{' '}
            <code className="font-mono">AI_KNOWLEDGE_URL=&quot;http://localhost:4020&quot;</code>.
          </Notice>
        ) : !docs?.ok ? (
          <Notice title="Daftar dokumen tidak bisa diambil" tone="danger">
            {docs?.error}
          </Notice>
        ) : (
          <>
            {canTest && <KnowledgeTest />}
            <KnowledgeView {...listView(docs.data, { q, category, page, per })} canManage={canManage} />
          </>
        )}
      </div>
    </div>
  )
}

function listView(
  docs: KnowledgeDoc[],
  { q, category, page, per }: { q: string; category: string; page: number; per: number },
) {
  const counts = new Map<string, number>()
  for (const d of docs) counts.set(d.category, (counts.get(d.category) ?? 0) + 1)
  const categories = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'id'))

  const needle = q.toLowerCase()
  const matching = docs.filter(
    (d) =>
      (!category || d.category === category) &&
      (!needle ||
        String(d.id) === needle ||
        d.title.toLowerCase().includes(needle) ||
        d.content.toLowerCase().includes(needle)),
  )

  const rows: KnowledgeRow[] = matching.slice((page - 1) * per, page * per).map((d) => ({
    id: d.id,
    category: d.category,
    title: d.title,
    content: d.content,
    created: d.createdAt
      ? new Date(d.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
      : '—',
  }))

  return { rows, total: matching.length, all: docs.length, page, per, categories, filters: { q, category } }
}

function Notice({ title, tone, children }: { title: string; tone?: 'danger'; children: React.ReactNode }) {
  return (
    <div className={tone === 'danger' ? 'rounded-lg border border-danger/40 bg-danger-bg p-4' : 'rounded-lg border bg-surface p-4'}>
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">{children}</p>
    </div>
  )
}
