/** Bundles the smoke harness with esbuild (borrowed from the globally installed tsx). */
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '../..')
const tsxRoot = execSync('npm root -g').toString().trim() + '/tsx'
const esbuild = createRequire(tsxRoot + '/package.json')('esbuild')

export async function build(outfile) {
  const alias = {
    swr: resolve(here, 'shims/swr.ts'),
    'next/navigation': resolve(here, 'shims/next-navigation.ts'),
    'next/link': resolve(here, 'shims/next-link.tsx'),
    react: resolve(ROOT, 'node_modules/react'),
    'react-dom': resolve(ROOT, 'node_modules/react-dom'),
  }
  const result = await esbuild.build({
    entryPoints: [resolve(here, 'harness.tsx')],
    bundle: true,
    outfile,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    jsx: 'automatic',
    sourcemap: 'inline',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"' },
    alias,
    nodePaths: [resolve(ROOT, 'node_modules')],
    metafile: true,
  })
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? '/tmp/ui-smoke/bundle.js'
  build(out).then((r) => { console.log('bundled', Object.keys(r.metafile.inputs).length, 'modules →', out) }).catch((e) => { console.error(e.message); process.exit(1) })
}
