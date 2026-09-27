import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@wa/db'
import { requireUser } from '@/lib/auth'
import { OPT_IN_LABEL } from '@/lib/contacts'
import { ContactForm } from '@/components/contact-form'
import { cn, shortTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      conversations: {
        include: { channel: { select: { name: true, displayPhone: true } } },
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      },
      recipients: {
        include: { campaign: { select: { id: true, name: true } } },
        orderBy: { id: 'desc' },
        take: 10,
      },
    },
  })
  if (!contact || contact.orgId !== user.orgId) notFound()

  const opt = OPT_IN_LABEL[contact.optInStatus] ?? OPT_IN_LABEL.UNKNOWN!
  const attributes = Object.entries((contact.attributes ?? {}) as Record<string, unknown>)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <Link href="/contacts" className="text-xs text-fg-muted hover:text-fg">
            ← Kontak
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-h5 text-fg">{contact.name || 'Tanpa nama'}</h1>
            <span className={cn('rounded px-1.5 py-px text-[10px]', opt.tone)}>{opt.label}</span>
          </div>
          <p className="mt-0.5 font-mono text-xs text-fg-muted">+{contact.waId}</p>
          <p className="mt-1 text-[11px] text-fg-muted">
            Terakhir aktif {shortTime(contact.lastSeenAt) || '—'} · tercatat sejak{' '}
            {contact.createdAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>

        <ContactForm
          id={contact.id}
          name={contact.name ?? ''}
          tags={contact.tags}
          attributes={attributes}
          optInStatus={contact.optInStatus}
          canEdit={user.role !== 'VIEWER'}
        />

        <section>
          <h2 className="text-sm text-fg">Percakapan</h2>
          <div className="mt-2 overflow-hidden rounded-lg border bg-surface">
            {contact.conversations.length === 0 && (
              <p className="p-4 text-center text-xs text-fg-muted">Belum ada percakapan.</p>
            )}
            {contact.conversations.map((c, i) => (
              <Link
                key={c.id}
                href={`/inbox/${c.id}`}
                className={cn('flex items-center justify-between p-3 text-[13px] hover:bg-muted', i > 0 && 'border-t')}
              >
                <span className="text-fg">
                  {c.channel.name} <span className="font-mono text-[11px] text-fg-muted">{c.channel.displayPhone}</span>
                </span>
                <span className="text-[11px] text-fg-muted">{shortTime(c.lastMessageAt)}</span>
              </Link>
            ))}
          </div>
        </section>

        {contact.recipients.length > 0 && (
          <section>
            <h2 className="text-sm text-fg">Broadcast yang diterima</h2>
            <div className="mt-2 overflow-hidden rounded-lg border bg-surface">
              {contact.recipients.map((r, i) => (
                <Link
                  key={r.id}
                  href={`/broadcast/${r.campaign.id}`}
                  className={cn('flex items-center justify-between p-3 text-[13px] hover:bg-muted', i > 0 && 'border-t')}
                >
                  <span className="text-fg">{r.campaign.name}</span>
                  <span className="text-[11px] text-fg-muted">{r.status.toLowerCase()}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
