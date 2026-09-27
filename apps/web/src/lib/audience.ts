import { prisma, OptInStatus } from '@wa/db'
import { audienceWhere, campaignAudienceSchema, type CampaignAudience } from '@wa/core'

/**
 * How many contacts a broadcast would reach, and how many it would hold back -
 * the same rules the runner applies when it starts. Callers check the role.
 */
export async function estimateAudience(orgId: string, audience: CampaignAudience) {
  const a = campaignAudienceSchema.parse(audience)
  const where = audienceWhere(orgId, a)

  const [total, optedOut, optedIn] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.count({ where: { ...where, optInStatus: OptInStatus.OPTED_OUT } }),
    prisma.contact.count({ where: { ...where, optInStatus: OptInStatus.OPTED_IN } }),
  ])
  const send = a.optInOnly ? optedIn : total - optedOut
  return { total, send, skipped: total - send }
}
