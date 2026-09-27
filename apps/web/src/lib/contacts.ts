import { prisma } from '@wa/db'

/** Every tag in use in the org, with how many contacts carry it, most used first. */
export async function orgTags(orgId: string) {
  const rows = await prisma.$queryRaw<{ tag: string; n: bigint }[]>`
    SELECT t.tag, COUNT(*) AS n
    FROM "Contact" c, unnest(c.tags) AS t(tag)
    WHERE c."orgId" = ${orgId}
    GROUP BY t.tag
    ORDER BY n DESC, t.tag ASC
    LIMIT 200
  `
  return rows.map((r) => ({ tag: r.tag, count: Number(r.n) }))
}

export { OPT_IN_LABEL } from './contacts-labels'
