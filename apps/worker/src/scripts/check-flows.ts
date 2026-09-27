/**
 * One-off: can this channel's token reach the WhatsApp Flows API?
 *
 * Reads the channel's token straight from the DB so the plaintext never lands
 * in shell history. Prints the outcome, never the token.
 *
 * Run:
 *   cd apps/worker && npx tsx src/scripts/check-flows.ts
 */
import { prisma } from '@wa/db'
import { loadEnvFile, credentialsFor } from '@wa/core'

loadEnvFile()

const channel = await prisma.channel.findFirst({ where: { status: 'CONNECTED' } })
if (!channel) {
  console.error('Tidak ada channel CONNECTED.')
  process.exit(1)
}

const creds = credentialsFor(channel)
console.log(`Channel : ${channel.name} (${channel.displayPhone})`)
console.log(`WABA    : ${creds.wabaId}`)
console.log(`Graph   : ${creds.graphVersion}\n`)

interface FlowsResponse {
  data?: { id: string; name: string; status: string; categories?: string[] }[]
  error?: unknown
}

/**
 * Meta's per-capability blocker report.
 *
 * Worth checking separately from the Flows API: a WABA can be allowed to
 * create and list Flows through the API while still being blocked from
 * *sending* one, and the send failure alone ("Blocked by Integrity") says
 * nothing about which entity caused it.
 */
interface HealthResponse {
  health_status?: {
    can_send_message?: string
    entities?: {
      entity_type?: string
      id?: string
      can_send_message?: string
      errors?: { error_code?: number; error_description?: string; possible_solution?: string }[]
    }[]
  }
  error?: unknown
}

async function health() {
  const res = await fetch(
    `https://graph.facebook.com/${creds.graphVersion}/${creds.phoneNumberId}?fields=health_status`,
    { headers: { Authorization: `Bearer ${creds.accessToken}` } },
  )
  const body = (await res.json().catch(() => null)) as HealthResponse | null

  if (!res.ok) {
    console.log(`\n— health_status: HTTP ${res.status}`)
    console.log(JSON.stringify(body?.error ?? body, null, 2))
    return
  }

  const h = body?.health_status
  console.log(`\n— health_status keseluruhan: ${h?.can_send_message ?? '?'}`)
  for (const e of h?.entities ?? []) {
    console.log(`   ${(e.entity_type ?? '?').padEnd(14)} ${e.can_send_message ?? '?'}`)
    for (const err of e.errors ?? []) {
      console.log(`      ⚠️  ${err.error_code}: ${err.error_description}`)
      if (err.possible_solution) console.log(`          → ${err.possible_solution}`)
    }
  }
}

const res = await fetch(
  `https://graph.facebook.com/${creds.graphVersion}/${creds.wabaId}/flows`,
  { headers: { Authorization: `Bearer ${creds.accessToken}` } },
)
const body = (await res.json().catch(() => null)) as FlowsResponse | null

if (res.ok) {
  const flows = body?.data ?? []
  console.log(`✅ Flows API bisa diakses. ${flows.length} flow terdaftar.`)
  for (const f of flows) {
    console.log(`   ${f.id}  ${f.status.padEnd(10)} ${f.name}  [${(f.categories ?? []).join(', ')}]`)
  }
  if (!flows.length) console.log('   (kosong — wajar kalau belum pernah bikin flow)')
} else {
  // The error body is the whole point of this script, so print it in full -
  // Meta distinguishes "missing permission" from "not eligible" only there.
  console.log(`❌ HTTP ${res.status}`)
  console.log(JSON.stringify(body?.error ?? body, null, 2))
}

await health()

await prisma.$disconnect()
