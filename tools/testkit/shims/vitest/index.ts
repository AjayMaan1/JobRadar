/**
 * Tiny vitest-compatible runner (describe/it/expect/beforeEach/afterEach). Same test files run under
 * real vitest locally; this shim is only for environments without node_modules.
 */
type Fn = () => void | Promise<void>
interface Suite { name: string; tests: Array<{ name: string; fn: Fn; skip?: boolean }>; before: Fn[]; after: Fn[]; beforeAllFns: Fn[]; afterAllFns: Fn[]; suites: Suite[] }
const root: Suite = { name: '', tests: [], before: [], after: [], beforeAllFns: [], afterAllFns: [], suites: [] }
let current = root
export const results: Array<{ suite: string; name: string; status: 'pass' | 'fail' | 'skip'; error?: string; ms: number }> = []

export function describe(name: string, fn: () => void) {
  const s: Suite = { name, tests: [], before: [], after: [], beforeAllFns: [], afterAllFns: [], suites: [] }
  current.suites.push(s)
  const prev = current
  current = s
  fn()
  current = prev
}
export function it(name: string, fn: Fn) { current.tests.push({ name, fn }) }
export const test = it
;(it as any).skip = (name: string, fn: Fn) => current.tests.push({ name, fn, skip: true })
export function beforeEach(fn: Fn) { current.before.push(fn) }
export function afterEach(fn: Fn) { current.after.push(fn) }
export function beforeAll(fn: Fn) { current.beforeAllFns.push(fn) }
export function afterAll(fn: Fn) { current.afterAllFns.push(fn) }
export const vi = { fn: (impl?: (...a: any[]) => any) => { const calls: any[][] = []; const f: any = (...a: any[]) => { calls.push(a); return impl?.(...a) }; f.mock = { calls }; return f } }

function fmt(v: any) { try { return JSON.stringify(v) } catch { return String(v) } }
function deepEq(a: any, b: any): boolean {
  if (b instanceof Asymmetric) return b.test(a)
  if (a === b) return true
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEq(a[k], b[k]))
}
class Asymmetric { constructor(readonly test: (v: any) => boolean, readonly label: string) {} }
export function expect(actual: any) {
  const build = (neg: boolean) => {
    const check = (ok: boolean, msg: string) => { if (ok === neg) throw new Error(`expect ${msg}${neg ? ' (negated)' : ''}\n  actual: ${fmt(actual)}`) }
    const m: any = {
      toBe: (e: any) => check(Object.is(actual, e), `toBe ${fmt(e)}`),
      toEqual: (e: any) => check(deepEq(actual, e), `toEqual ${fmt(e)}`),
      toStrictEqual: (e: any) => check(deepEq(actual, e), `toStrictEqual ${fmt(e)}`),
      toBeNull: () => check(actual === null, 'toBeNull'),
      toBeUndefined: () => check(actual === undefined, 'toBeUndefined'),
      toBeDefined: () => check(actual !== undefined, 'toBeDefined'),
      toBeTruthy: () => check(!!actual, 'toBeTruthy'),
      toBeFalsy: () => check(!actual, 'toBeFalsy'),
      toContain: (e: any) => check(Array.isArray(actual) ? actual.includes(e) : String(actual).includes(e), `toContain ${fmt(e)}`),
      toHaveLength: (n: number) => check(actual?.length === n, `toHaveLength ${n}`),
      toBeGreaterThan: (n: number) => check(actual > n, `toBeGreaterThan ${n}`),
      toBeGreaterThanOrEqual: (n: number) => check(actual >= n, `toBeGreaterThanOrEqual ${n}`),
      toBeLessThan: (n: number) => check(actual < n, `toBeLessThan ${n}`),
      toBeLessThanOrEqual: (n: number) => check(actual <= n, `toBeLessThanOrEqual ${n}`),
      toMatch: (re: RegExp | string) => check(typeof re === 'string' ? String(actual).includes(re) : re.test(String(actual)), `toMatch ${re}`),
      toMatchObject: (e: any) => check(Object.entries(e).every(([k, v]) => deepEq(actual?.[k], v)), `toMatchObject ${fmt(e)}`),
      toHaveProperty: (k: string) => check(actual != null && k in actual, `toHaveProperty ${k}`),
      toBeInstanceOf: (c: any) => check(actual instanceof c, `toBeInstanceOf ${c?.name}`),
      toBeCloseTo: (n: number, digits = 2) => check(Math.abs(actual - n) < Math.pow(10, -digits) / 2, `toBeCloseTo ${n}`),
      toBeNaN: () => check(Number.isNaN(actual), 'toBeNaN'),
      toThrow: (re?: RegExp | string | (new (...a: any[]) => any)) => { let threw: any = null; try { actual() } catch (e) { threw = e }; check(!!threw && (!re || (typeof re === 'function' ? threw instanceof re : typeof re === 'string' ? String(threw.message).includes(re) : re.test(String(threw.message)))), `toThrow ${typeof re === 'function' ? re.name : re ?? ''}`) },
    }
    return m
  }
  const pos = build(false)
  pos.not = build(true)
  pos.resolves = new Proxy({}, { get: (_t, k) => async (...a: any[]) => (expect(await actual) as any)[k](...a) })
  pos.rejects = new Proxy({}, { get: (_t, k) => async (...a: any[]) => {
    let err: any = null
    try { await actual } catch (e) { err = e }
    if (!err) throw new Error('expect(...).rejects: promise resolved')
    if (k === 'toThrow') { const re = a[0]; if (re && !(typeof re === 'string' ? String(err.message).includes(re) : re.test(String(err.message)))) throw new Error(`rejects.toThrow ${re}\n  actual: ${err.message}`); return }
    return (expect(err) as any)[k](...a)
  } })
  return pos
}
expect.arrayContaining = (items: any[]) => new Asymmetric((v) => Array.isArray(v) && items.every((i) => v.some((x: any) => deepEq(x, i))), 'arrayContaining')
expect.objectContaining = (o: Record<string, any>) => new Asymmetric((v) => v != null && Object.entries(o).every(([k, val]) => deepEq(v[k], val)), 'objectContaining')
expect.any = (c: any) => new Asymmetric((v) => c === String ? typeof v === 'string' : c === Number ? typeof v === 'number' : c === Boolean ? typeof v === 'boolean' : v instanceof c, 'any')
expect.stringContaining = (sub: string) => new Asymmetric((v) => typeof v === 'string' && v.includes(sub), 'stringContaining')

export async function run(suite: Suite = root, path: string[] = [], inherited: { before: Fn[]; after: Fn[] } = { before: [], after: [] }) {
  const before = [...inherited.before, ...suite.before]
  const after = [...suite.after, ...inherited.after]
  let setupError: string | null = null
  for (const b of suite.beforeAllFns) {
    try { await b() } catch (err) { setupError = (err as Error).stack ?? String(err); break }
  }
  for (const t of suite.tests) {
    if (setupError) { results.push({ suite: [...path, suite.name].filter(Boolean).join(' › '), name: t.name, status: 'fail', error: `beforeAll failed: ${setupError}`, ms: 0 }); continue }
    const name = [...path, suite.name].filter(Boolean).join(' › ')
    if (t.skip) { results.push({ suite: name, name: t.name, status: 'skip', ms: 0 }); continue }
    const start = Date.now()
    try {
      for (const b of before) await b()
      await t.fn()
      for (const a of after) await a()
      results.push({ suite: name, name: t.name, status: 'pass', ms: Date.now() - start })
    } catch (err) {
      results.push({ suite: name, name: t.name, status: 'fail', error: (err as Error).stack ?? String(err), ms: Date.now() - start })
    }
  }
  for (const s of suite.suites) await run(s, [...path, suite.name].filter(Boolean), { before, after })
  for (const a of suite.afterAllFns) { try { await a() } catch { /* ignore */ } }
}
export function resetRegistry() { root.tests = []; root.suites = []; root.before = []; root.after = []; root.beforeAllFns = []; root.afterAllFns = []; current = root }
