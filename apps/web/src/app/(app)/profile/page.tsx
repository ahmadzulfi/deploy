import { notFound } from 'next/navigation'
import { prisma, type Role } from '@wa/db'
import { requireUser } from '@/lib/auth'
import { NameForm, PasswordForm } from '@/components/profile/profile-forms'
import { cn, initials, shortTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const ROLE: Record<Role, { label: string; can: string }> = {
  OWNER: { label: 'Pemilik', can: 'Akses penuh, termasuk pengaturan, API key, dan semua nomor.' },
  ADMIN: { label: 'Admin', can: 'Mengatur nomor, WABA, API key, webhook, dan pengguna.' },
  SUPERVISOR: { label: 'Supervisor', can: 'Membalas percakapan, mengatur label, flow, template, dan broadcast.' },
  AGENT: { label: 'Agen', can: 'Membalas dan menangani percakapan di Inbox.' },
  VIEWER: { label: 'Pengamat', can: 'Hanya bisa membaca; tidak bisa mengirim atau mengubah apa pun.' },
}

export default async function ProfilePage() {
  const session = await requireUser()

  const [user, sent, open, total, activity] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.id },
      include: {
        org: { select: { name: true } },
        channelAccess: { include: { channel: { select: { name: true } } } },
      },
    }),
    prisma.message.count({ where: { sentByUserId: session.id } }),
    prisma.conversation.count({ where: { assigneeId: session.id, status: { not: 'CLOSED' } } }),
    prisma.conversation.count({ where: { assigneeId: session.id } }),
    prisma.auditLog.findMany({
      where: { actorId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, action: true, resourceType: true, createdAt: true },
    }),
  ])
  if (!user) notFound()

  const role = ROLE[user.role]
  // No rows means every number in the org, not none.
  const channels = user.channelAccess.map((a) => a.channel.name)
  const joined = user.createdAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 p-6">
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent-bg text-lg font-medium text-fg">
            {initials(user.name, user.email)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-h5 text-fg">{user.name}</h1>
            <p className="mt-0.5 truncate text-xs text-fg-muted">
              {user.email} · {role.label} di {user.org.name} · bergabung {joined}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ['Pesan terkirim', sent],
              ['Percakapan aktif', open],
              ['Pernah ditangani', total],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-lg border bg-surface px-4 py-3">
              <div className="text-[11px] text-fg-muted">{k}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-fg">{v.toLocaleString('id-ID')}</div>
            </div>
          ))}
        </div>

        <section>
          <h2 className="text-sm text-fg">Data diri</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">Nama yang dilihat rekan kerja di dashboard.</p>
          <NameForm name={user.name} email={user.email} />
        </section>

        <section>
          <h2 className="text-sm text-fg">Kata sandi</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">
            Sesi yang sudah masuk tetap berjalan; kata sandi baru berlaku saat masuk berikutnya.
          </p>
          <PasswordForm />
        </section>

        <section>
          <h2 className="text-sm text-fg">Akses</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">Diatur oleh admin organisasi.</p>
          <div className="overflow-hidden rounded-lg border bg-surface">
            <Row k="Peran">
              <span className="text-fg">{role.label}</span>
              <span className="text-fg-muted"> — {role.can}</span>
            </Row>
            <Row k="Nomor" first={false}>
              {channels.length === 0 ? (
                <span className="text-fg">Semua nomor di organisasi</span>
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {channels.map((c) => (
                    <span key={c} className="rounded bg-muted px-1.5 py-px text-fg">
                      {c}
                    </span>
                  ))}
                </span>
              )}
            </Row>
          </div>
        </section>

        <section>
          <h2 className="text-sm text-fg">Aktivitas terakhir</h2>
          <p className="mt-1 mb-3 text-xs text-fg-muted">Perubahan yang kamu buat, dari catatan audit.</p>
          {activity.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-fg-muted">
              Belum ada perubahan tercatat.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-surface">
              {activity.map((a, i) => (
                <div key={a.id} className={cn('flex items-center gap-4 px-4 py-2.5', i > 0 && 'border-t')}>
                  <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">{a.action}</code>
                  <span className="shrink-0 text-[11px] text-fg-muted">{a.resourceType}</span>
                  <span className="w-14 shrink-0 text-right text-[11px] text-fg-muted">{shortTime(a.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Row({ k, first = true, children }: { k: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex gap-4 px-4 py-2.5 text-[11px]', !first && 'border-t')}>
      <span className="w-20 shrink-0 text-fg-muted">{k}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}
