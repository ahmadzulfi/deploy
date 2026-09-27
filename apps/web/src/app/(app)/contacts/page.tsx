import { prisma, OptInStatus, type Prisma } from '@wa/db'
import { hasRole, requireUser } from '@/lib/auth'
import { orgTags } from '@/lib/contacts'
import { ContactsView, type ContactRow } from '@/components/contacts/contacts-view'
import { shortTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const PAGE_SIZES = [10, 25, 50, 100]
const SEEN_DAYS: Record<string, number> = { '7': 7, '30': 30, '90': 90 }

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; tag?: string; status?: string; seen?: string; page?: string; per?: string }>
}) {
  const user = await requireUser()
  const sp = await searchParams
  const view = sp.view === 'groups' ? 'groups' : 'contacts'
  const q = sp.q?.trim() ?? ''
  const tag = sp.tag?.trim() ?? ''
  const status = sp.status && sp.status in OptInStatus ? (sp.status as OptInStatus) : ''
  const seen = sp.seen === 'never' || (sp.seen && SEEN_DAYS[sp.seen]) ? sp.seen : ''
  const per = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 50
  const page = Math.max(1, Number(sp.page) || 1)

  const tags = await orgTags(user.orgId)
  const perms = {
    canEdit: hasRole(user, 'AGENT'),
    canImport: hasRole(user, 'SUPERVISOR'),
    canDelete: hasRole(user, 'ADMIN'),
  }
  const filters = { q, tag, status, seen }

  if (view === 'groups') {
    return <ContactsView view="groups" rows={[]} total={0} page={1} per={per} tags={tags} filters={filters} {...perms} />
  }

  // Digits search the number, anything else the name - "0812" typed the way
  // people write it locally still finds 62812.
  const digits = q.replace(/\D/g, '')
  const since = seen && seen !== 'never' ? new Date(Date.now() - SEEN_DAYS[seen]! * 86_400_000) : null
  const where: Prisma.ContactWhereInput = {
    orgId: user.orgId,
    ...(tag ? { tags: { has: tag } } : {}),
    ...(status ? { optInStatus: status } : {}),
    ...(seen === 'never' ? { lastSeenAt: null } : since ? { lastSeenAt: { gte: since } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            ...(digits ? [{ waId: { contains: digits.replace(/^0/, '') } }] : []),
          ],
        }
      : {}),
  }

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: (page - 1) * per,
      take: per,
    }),
    prisma.contact.count({ where }),
  ])

  const rows: ContactRow[] = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    waId: c.waId,
    tags: c.tags,
    optInStatus: c.optInStatus,
    lastSeen: shortTime(c.lastSeenAt),
    created: c.createdAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
  }))

  return <ContactsView view="contacts" rows={rows} total={total} page={page} per={per} tags={tags} filters={filters} {...perms} />
}
