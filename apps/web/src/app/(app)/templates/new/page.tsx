import Link from 'next/link'
import { prisma } from '@wa/db'
import { hasRole, requireUser } from '@/lib/auth'
import { TemplateWizard } from '@/components/templates/template-wizard'

export const dynamic = 'force-dynamic'

export default async function NewTemplatePage() {
  const user = await requireUser()

  if (!hasRole(user, 'SUPERVISOR')) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="rounded-lg border bg-surface p-6 text-center text-sm text-fg-muted">
          Membuat template butuh peran supervisor ke atas. <Link href="/templates" className="text-accent underline">Kembali</Link>
        </p>
      </div>
    )
  }

  // Templates belong to a WABA, not a number: offer each WABA once, named
  // after its connection or, failing that, its first number.
  const channels = await prisma.channel.findMany({
    where: { orgId: user.orgId, wabaId: { not: null }, accessTokenEnc: { not: null }, phoneNumberId: { not: null } },
    orderBy: { createdAt: 'asc' },
    include: { connection: { select: { name: true } } },
  })
  const wabas = [...new Map(channels.map((c) => [c.wabaId!, c])).values()].map((c) => ({
    wabaId: c.wabaId!,
    label: c.connection?.name ?? `${c.name}${c.displayPhone ? ` (${c.displayPhone})` : ''}`,
  }))

  return <TemplateWizard wabas={wabas} />
}
