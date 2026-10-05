import { prisma } from '@wa/db'
import { AI_PRESETS, aiConfigOf, headerNames } from '@wa/core'
import { hasRole, requireUser } from '@/lib/auth'
import { aiUsage } from '@/lib/ai'
import { shortTime } from '@/lib/utils'
import { AiEndpoints } from '@/components/ai/ai-endpoints'

export const dynamic = 'force-dynamic'

function hostOf(url: string) {
  try {
    return new URL(url.replace(/\{\{\s*\w+\s*\}\}/g, 'x')).host
  } catch {
    return url
  }
}

export default async function AiPage() {
  const user = await requireUser()
  const canManage = hasRole(user, 'ADMIN')

  const [rows, usage] = await Promise.all([
    prisma.aiEndpoint.findMany({ where: { orgId: user.orgId }, orderBy: { name: 'asc' } }),
    aiUsage(user.orgId),
  ])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <h1 className="text-h5 text-fg">AI</h1>
          <p className="mt-1 text-xs text-fg-muted">
            Simpan layanan AI di sini sekali, lalu pakai di flow cukup dengan memilih namanya. AI jenis{' '}
            <span className="text-fg">Jawab pertanyaan</span> dipakai node Tanya AI; jenis{' '}
            <span className="text-fg">Arahkan ke menu</span> dipakai node Arahkan AI untuk langsung membawa warga ke
            jawaban di menu tanpa mengirim menu bertingkat. URL dan API key hanya diatur di halaman ini.
          </p>
        </div>

        <AiEndpoints
          canManage={canManage}
          presets={AI_PRESETS}
          endpoints={rows.map((r) => {
            const failing = !!r.lastErrorAt && (!r.lastUsedAt || r.lastErrorAt >= r.lastUsedAt)
            return {
              id: r.id,
              name: r.name,
              kind: r.kind,
              method: r.method === 'GET' ? ('GET' as const) : ('POST' as const),
              host: hostOf(r.url),
              // The full config is for whoever may edit it; a URL can carry a
              // key in its query string.
              url: canManage ? r.url : '',
              body: canManage ? r.body : '',
              answerTemplate: canManage ? r.answerTemplate : '',
              timeoutSeconds: r.timeoutSeconds,
              // Names only: the values usually include the API key.
              headerNames: canManage && r.headersEnc ? headerNames(aiConfigOf(r).headers) : [],
              usedIn: usage.get(r.id) ?? [],
              lastUsedAt: r.lastUsedAt ? shortTime(r.lastUsedAt) : null,
              lastError: failing ? r.lastError : null,
            }
          })}
        />
      </div>
    </div>
  )
}
