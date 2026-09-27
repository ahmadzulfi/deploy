// One-off: turns the exported "template-wa-mantap-cimahi.md" into a JSON map
// { "1": "...body...", ... } that the flow seed reads. Kept as a script rather
// than a pasted blob so the wording stays traceable to the export.
import { readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2]
const out = process.argv[3]
const md = readFileSync(src, 'utf8')

const templates = {}
const re = /^## Template (\d+)\s*\n\s*```\n([\s\S]*?)\n```/gm
let m
while ((m = re.exec(md))) {
  // The export flattens reply buttons into "Button N: title" lines. The flow
  // models those as real edges, so they are dropped from the body here.
  const body = m[2].replace(/\n?^Button \d+: .*$/gm, '').trimEnd()
  templates[m[1]] = body
}

writeFileSync(out, JSON.stringify(templates, null, 2), 'utf8')
console.log(`${Object.keys(templates).length} templates -> ${out}`)
