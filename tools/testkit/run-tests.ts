/**
 * Test runner for environments without vitest (uses tools/testkit/shims/vitest). Usage:
 *   tsx tools/testkit/run-tests.ts <report-name> <file...>
 * Writes reports/<report-name>.json and reports/<report-name>.md and exits non-zero on failure.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { run, results, resetRegistry } from 'vitest'

async function main() {
const [reportName, ...files] = process.argv.slice(2)
const all: Array<{ file: string; suite: string; name: string; status: string; error?: string; ms: number }> = []
const started = Date.now()

for (const f of files) {
  resetRegistry()
  results.length = 0
  const abs = resolve(f)
  try {
    await import(pathToFileURL(abs).href)
    await run()
  } catch (err) {
    results.push({ suite: f, name: '(import/setup)', status: 'fail', error: (err as Error).stack ?? String(err), ms: 0 })
  }
  for (const r of results) all.push({ file: f, ...r })
}

const pass = all.filter((r) => r.status === 'pass').length
const fail = all.filter((r) => r.status === 'fail').length
const skip = all.filter((r) => r.status === 'skip').length

let md = `# ${reportName}\n\nGenerated ${new Date().toISOString()} · ${all.length} tests · **${pass} passed** · ${fail} failed · ${skip} skipped · ${Date.now() - started} ms\n\n`
let lastFile = ''
for (const r of all) {
  if (r.file !== lastFile) { md += `\n## ${r.file}\n\n`; lastFile = r.file }
  const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⏭'
  md += `- ${icon} ${r.suite ? `${r.suite} › ` : ''}${r.name} (${r.ms} ms)\n`
  if (r.error) md += '\n```\n' + r.error.split('\n').slice(0, 12).join('\n') + '\n```\n\n'
}
mkdirSync('reports', { recursive: true })
writeFileSync(`reports/${reportName}.md`, md)
writeFileSync(`reports/${reportName}.json`, JSON.stringify({ reportName, generatedAt: new Date().toISOString(), summary: { total: all.length, pass, fail, skip }, results: all }, null, 2))

for (const r of all) {
  const icon = r.status === 'pass' ? '\x1b[32m✓\x1b[0m' : r.status === 'fail' ? '\x1b[31m✗\x1b[0m' : '-'
  console.log(`${icon} ${r.suite ? `${r.suite} › ` : ''}${r.name} (${r.ms}ms)`)
  if (r.error) console.log('   ' + r.error.split('\n').slice(0, 6).join('\n   '))
}
console.log(`\n${reportName}: ${pass} passed, ${fail} failed, ${skip} skipped → reports/${reportName}.md`)
process.exit(fail ? 1 : 0)
}
main().catch((err) => { console.error(err); process.exit(1) })
