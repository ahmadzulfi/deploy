import { z } from 'zod'
import { interpolate, type FlowContext } from './flow/runtime.js'

/**
 * Broadcast rules that do not need a database: who is in the audience, and
 * what each recipient's template blanks become.
 *
 * Kept pure so the dashboard can preview exactly what the runner will send.
 */

export const campaignAudienceSchema = z.object({
  /** Empty = every contact in the org. */
  tags: z.array(z.string().trim().min(1)).default([]),
  /** `any`: has at least one of the tags. `all`: has every one. */
  match: z.enum(['any', 'all']).default('any'),
  /**
   * Only contacts who messaged us first (or were marked opted in). Meta's
   * policy asks for opt-in before business-initiated messages, so this is on
   * unless someone deliberately turns it off.
   */
  optInOnly: z.boolean().default(true),
})

export type CampaignAudience = z.infer<typeof campaignAudienceSchema>

/** Template slot key -> literal text, which may contain `{{contact.name}}` and friends. */
export const campaignVariableMapSchema = z.record(z.string())

export type CampaignVariableMap = z.infer<typeof campaignVariableMapSchema>

export interface CampaignContact {
  name?: string | null
  waId: string
  attributes?: Record<string, unknown>
  tags?: string[]
}

/**
 * Meta refuses a text parameter containing a newline, a tab, or more than four
 * spaces in a row - with an error that names neither. A contact attribute can
 * easily contain one, so they are flattened rather than failing the send.
 */
function flattenParam(v: string) {
  return v.replace(/[\r\n\t]+/g, ' ').replace(/ {5,}/g, '    ').trim()
}

/**
 * Fills one recipient's template blanks.
 *
 * `empty` lists blanks that came out blank - typically `{{contact.name}}` for
 * a contact with no name. The runner fails those recipients with that reason
 * instead of letting Meta reject the send with a vaguer one.
 */
export function renderCampaignValues(
  map: CampaignVariableMap,
  contact: CampaignContact,
  channel: FlowContext['channel'],
): { values: Record<string, string>; empty: string[] } {
  const ctx: FlowContext = { variables: {}, contact, channel }
  const values: Record<string, string> = {}
  const empty: string[] = []

  for (const [key, template] of Object.entries(map)) {
    const rendered = interpolate(template, ctx)
    // Media header links pass through untouched: flattening a URL could break it.
    const v = key === 'header.media' ? rendered.trim() : flattenParam(rendered)
    if (!v) empty.push(key)
    values[key] = v
  }
  return { values, empty }
}

/** Contact fields a broadcast can personalise with, offered as hints in the form. */
export const CAMPAIGN_PLACEHOLDERS = ['{{contact.name}}', '{{contact.phone}}', '{{contact.<atribut>}}', '{{channel.name}}']
