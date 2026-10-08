import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { prisma, Prisma } from '@wa/db'
import { buildRouteCatalog, flowGraphSchema, loadEnvFile, validateFlow } from '@wa/core'

/**
 * Puts Petunjuk AI on the list rows of a flow's draft, by row id.
 *
 * The hints live in a JSON file ({ "rowId": "petunjuk" }) so they can be
 * reviewed in one place and kept when the flow is seeded again; the editor
 * is the place to change one or two afterwards. Only the draft is touched,
 * and only with --write: publishing stays a human decision.
 *
 *   tsx src/scripts/apply-ai-hints.ts <flowId>                 # lihat saja
 *   tsx src/scripts/apply-ai-hints.ts <flowId> --write         # tulis draf
 *   tsx src/scripts/apply-ai-hints.ts <flowId> lain.json --write
 *   tsx src/scripts/apply-ai-hints.ts <flowId> --catalog tujuan.json
 *
 * --catalog saves the destinations Arahkan AI would then send, in the shape
 * tools/route-eval.mjs reads, so a router can be scored before writing.
 */

loadEnvFile()

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const write = args.includes('--write')
const catalogAt = args.indexOf('--catalog')
const catalogOut = catalogAt >= 0 ? args[catalogAt + 1] : undefined
const [flowId, file = resolve(here, 'cimahi-ai-hints.json')] = args.filter(
  (a, i) => a !== '--write' && (catalogAt < 0 || (i !== catalogAt && i !== catalogAt + 1)),
)
if (!flowId) {
  console.error('Usage: tsx src/scripts/apply-ai-hints.ts <flowId> [hints.json] [--write] [--catalog out.json]')
  process.exit(1)
}

const hints = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>

const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { name: true, draftGraph: true } })
if (!flow) {
  console.error(`Flow ${flowId} tidak ditemukan.`)
  process.exit(1)
}
const parsed = flowGraphSchema.safeParse(flow.draftGraph)
if (!parsed.success) {
  console.error('Draf flow ini tidak valid; buka di editor dulu.')
  process.exit(1)
}

const used = new Set<string>()
let changed = 0
const nodes = parsed.data.nodes.map((n) => {
  if (n.data.kind !== 'sendList') return n
  const sections = n.data.sections.map((s) => ({
    ...s,
    rows: s.rows.map((r) => {
      const hint = hints[r.id]?.trim()
      if (!hint) return r
      used.add(r.id)
      if (r.aiHint === hint) return r
      changed++
      return { ...r, aiHint: hint }
    }),
  }))
  return { ...n, data: { ...n.data, sections } }
})
const graph = { ...parsed.data, nodes }

const unknown = Object.keys(hints).filter((id) => !used.has(id))
const catalog = buildRouteCatalog(graph)
const withoutWords = catalog.filter((d) => !d.description.trim()).map((d) => d.id)

console.log(`${flow.name}`)
console.log(`${used.size} baris diberi petunjuk, ${changed} berubah dari draf sekarang`)
if (unknown.length) console.log(`Tidak ada di flow ini (dilewati): ${unknown.join(', ')}`)
console.log(`${catalog.length} tujuan Arahkan AI, ${withoutWords.length} masih tanpa keterangan maupun petunjuk`)

if (catalogOut) {
  writeFileSync(catalogOut, JSON.stringify(catalog.map(({ target: _target, ...d }) => d), null, 1))
  console.log(`Katalog disimpan ke ${catalogOut}`)
}

const issues = validateFlow(graph)
const errors = issues.filter((i) => i.severity === 'error')
for (const i of errors) console.log(`  [error] ${i.nodeId ?? '-'}: ${i.message}`)

if (errors.length) {
  console.error(`\n${errors.length} error — draf tidak ditulis.`)
} else if (!write) {
  console.log('\nBelum ditulis. Ulangi dengan --write untuk menyimpan ke draf.')
} else if (changed === 0) {
  console.log('\nTidak ada yang berubah.')
} else {
  await prisma.flow.update({ where: { id: flowId }, data: { draftGraph: graph as unknown as Prisma.InputJsonValue } })
  console.log('\nDraf tersimpan. Tinjau di editor, lalu terbitkan sendiri.')
}
await prisma.$disconnect()
