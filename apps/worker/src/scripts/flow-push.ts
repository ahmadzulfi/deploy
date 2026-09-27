import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { prisma } from '@wa/db'
import { cloudApiProvider, credentialsFor, loadEnvFile, type FlowCategory } from '@wa/core'

/**
 * Pushes a Flow JSON file in `wa-flows/` to Meta as a DRAFT.
 *
 * The Flow JSON lives in the repo rather than only inside Meta's Flow Builder,
 * so the form is reviewable in a diff like everything else. This script only
 * ever creates drafts: a published Flow can never be edited or deleted, so
 * publishing is a separate, deliberate act.
 *
 * Run:
 *   cd apps/worker && npx tsx src/scripts/flow-push.ts              # list files
 *   cd apps/worker && npx tsx src/scripts/flow-push.ts uji-pendaftaran
 */

loadEnvFile()

const here = dirname(fileURLToPath(import.meta.url))
const dir = resolve(here, 'wa-flows')

const slug = process.argv[2]
if (!slug) {
  console.log('Flow JSON yang tersedia:')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.flow.json'))) {
    console.log(`  ${f.replace('.flow.json', '')}`)
  }
  console.log('\nPakai: npx tsx src/scripts/flow-push.ts <nama>')
  process.exit(0)
}

const flowJson: unknown = JSON.parse(readFileSync(resolve(dir, `${slug}.flow.json`), 'utf8'))

const channel = await prisma.channel.findFirst({ where: { status: 'CONNECTED' } })
if (!channel) {
  console.error('Tidak ada channel CONNECTED.')
  process.exit(1)
}
const creds = credentialsFor(channel)

const name = `${slug} (${new Date().toISOString().slice(0, 10)})`
const categories: FlowCategory[] = ['SIGN_UP']

console.log(`Channel : ${channel.name}`)
console.log(`WABA    : ${creds.wabaId}`)
console.log(`Nama    : ${name}`)
console.log(`Kategori: ${categories.join(', ')}\n`)

const { metaFlowId, validationErrors } = await cloudApiProvider.createFlow(creds, {
  name,
  categories,
  flowJson,
})

console.log(`✅ Flow dibuat sebagai DRAFT — id ${metaFlowId}`)

// Meta accepts a Flow JSON with problems and reports them here instead of
// failing, so a "successful" create can still produce an unsendable Flow.
if (validationErrors.length) {
  console.log(`\n⚠️  ${validationErrors.length} masalah validasi:`)
  for (const e of validationErrors) {
    const at = e.lineStart !== undefined ? ` (baris ${e.lineStart})` : ''
    console.log(`   [${e.error}]${at} ${e.message}`)
  }
} else {
  console.log('   Tidak ada error validasi.')
}

console.log('\nLangkah berikutnya:')
console.log(`   publish : npx tsx src/scripts/flow-publish.ts ${metaFlowId}`)
console.log(`   hapus   : npx tsx src/scripts/flow-delete.ts ${metaFlowId}   (selagi masih DRAFT)`)

await prisma.$disconnect()
