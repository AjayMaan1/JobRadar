/** Compiles apps/web/app/globals.css with the real Tailwind config (tailwind 3.4 borrowed from mermaid-cli's deps). */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '../..')
const WEB = resolve(ROOT, 'apps/web')

function findTailwind() {
  const g = execSync('npm root -g').toString().trim()
  for (const base of [g + '/tailwindcss', g + '/@mermaid-js/mermaid-cli/node_modules/tailwindcss']) {
    try { const req = createRequire(base + '/package.json'); return { tailwind: req('tailwindcss'), postcss: req('postcss'), version: req('tailwindcss/package.json').version } } catch { /* next */ }
  }
  return null
}

export async function buildCss(outfile) {
  const tw = findTailwind()
  if (!tw) return null
  const config = {
    content: [resolve(WEB, 'app/**/*.{ts,tsx}'), resolve(WEB, 'components/**/*.{ts,tsx}')],
    theme: { extend: {} },
    plugins: [],
  }
  const css = readFileSync(resolve(WEB, 'app/globals.css'), 'utf8')
  const result = await tw.postcss([tw.tailwind(config)]).process(css, { from: resolve(WEB, 'app/globals.css'), to: outfile })
  writeFileSync(outfile, result.css)
  return { version: tw.version, bytes: result.css.length, warnings: result.warnings().map((w) => w.toString()) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildCss(process.argv[2] ?? '/tmp/ui-smoke/smoke.css').then((r) => console.log(r ? `tailwind ${r.version} → ${r.bytes} bytes${r.warnings.length ? '\n' + r.warnings.join('\n') : ''}` : 'tailwind not available')).catch((e) => { console.error(e.message); process.exit(1) })
}
