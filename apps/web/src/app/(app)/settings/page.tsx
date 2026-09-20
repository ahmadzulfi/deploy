import { prisma } from '@wa/db'
import { metaSettings } from '@wa/core'
import { requireUser } from '@/lib/auth'
import { Connections } from '@/components/settings/connections'
import { MetaSettingsForm } from '@/components/settings/meta-form'
import { ApiKeys } from '@/components/settings/api-keys'
import { cn, shortTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const user = await requireUser()
  const canManage = user.role === 'OWNER' || user.role === 'ADMIN'

  const [settings, org, keys, connections] = await Promise.all([
    metaSettings(user.orgId),
    prisma.organization.findUnique({ where: { id: user.orgId } }),
    prisma.apiKey.findMany({
      where: { orgId: user.orgId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.wabaConnection.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { channels: true } } },
    }),
  ])

  // The webhook receiver lives on its own port, so the callback URL cannot be
  // derived from this request. Shown as a template the user completes with
  // their tunnel or domain.
  const origin = process.env.PUBLIC_WEBHOOK_ORIGIN ?? 'https://<tunnel-kamu>'

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 p-6">
        <div>
          <h1 className="text-base text-fg">Pengaturan</h1>
          <p className="mt-1 text-xs text-fg-muted">
            Kredensial aplikasi dan akses API. Nilai per-nomor diatur di halaman Nomor.
          </p>
        </div>

        <section>
          <h2 className="text-sm text-fg">Akun WhatsApp Business</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">
            Tiap WABA membawa kredensial Meta App-nya sendiri, jadi punya callback URL
            sendiri — webhook tidak bisa tahu secret mana yang harus dipakai sebelum tahu
            koneksi mana yang mengirim.
          </p>

          <Connections
            canManage={canManage}
            origin={origin}
            rows={connections.map((c) => ({
              id: c.id,
              name: c.name,
              wabaId: c.wabaId,
              metaAppId: c.metaAppId,
              verifyToken: c.verifyToken,
              status: c.status,
              graphVersion: c.graphVersion,
              channelCount: c._count.channels,
              lastSyncAt: c.lastSyncAt ? shortTime(c.lastSyncAt) : null,
              lastError: c.lastError,
            }))}
          />
        </section>

        <section>
          <h2 className="text-sm text-fg">Integrasi Meta (lama)</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">
            Dipakai oleh callback lama <code className="font-mono">/webhooks/whatsapp</code>,
            untuk instalasi yang dikonfigurasi sebelum koneksi per-WABA ada. Koneksi baru
            tidak memakainya.
          </p>

          <MetaSettingsForm
            canManage={canManage}
            appSecretSource={settings.source.appSecret}
            verifyToken={org?.webhookVerifyToken ?? settings.verifyToken}
            graphVersion={settings.graphVersion}
          />
        </section>

        <section>
          <h2 className="text-sm text-fg">API key</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">
            Untuk sistem internal lain yang memanggil platform ini. Kunci hanya ditampilkan
            sekali saat dibuat — setelah itu hanya sidik jaringnya yang tersimpan.
          </p>

          <ApiKeys
            canManage={canManage}
            keys={keys.map((k) => ({
              id: k.id,
              name: k.name,
              scopes: k.scopes,
              createdAt: shortTime(k.createdAt),
              lastUsedAt: k.lastUsedAt ? shortTime(k.lastUsedAt) : null,
            }))}
          />
        </section>

        <section>
          <h2 className="text-sm text-fg">Tetap di berkas .env</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">
            Nilai berikut tidak bisa dipindah ke sini: semuanya dibutuhkan sebelum database
            bisa dibaca, dan kunci enkripsi tidak mungkin melindungi dirinya sendiri.
          </p>

          <div className="overflow-hidden rounded-lg border bg-surface">
            {[
              ['ENCRYPTION_KEY', 'Melindungi token channel dan app secret di database'],
              ['AUTH_SECRET', 'Menandatangani sesi login'],
              ['DATABASE_URL', 'Koneksi Postgres'],
              ['REDIS_URL', 'Koneksi antrean'],
              ['META_GRAPH_VERSION', `Versi Graph API — sekarang ${settings.graphVersion}`],
            ].map(([key, why], i) => (
              <div key={key} className={cn('flex gap-4 px-4 py-2.5', i > 0 && 'border-t')}>
                <code className="w-44 shrink-0 font-mono text-[11px] text-fg">{key}</code>
                <span className="text-[11px] text-fg-muted">{why}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
