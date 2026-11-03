import { ResumeContentSchema, type ResumeContent } from '../schema/resume.js'
import { validateGrounding, type GroundingResult } from '../ground/validate.js'

/**
 * Editor support (docs/HLD-resume-editor.md): diff two resume documents into an attributable change log, and
 * run the grounding validator on every string the user added or changed. Pure; used by the browser (live
 * flags) and by the server (stored on the version) so both agree.
 */
export interface ContentChange {
  /** JSON pointer, e.g. /work/0/highlights/2 or /skills/1/keywords */
  path: string
  before: string | null
  after: string | null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function walk(a: unknown, b: unknown, path: string, out: ContentChange[]): void {
  if (Array.isArray(a) || Array.isArray(b)) {
    const A = Array.isArray(a) ? a : [], B = Array.isArray(b) ? b : []
    // arrays of strings (bullets, keywords): compare as a whole when lengths differ, element-wise otherwise
    const strings = [...A, ...B].every((x) => typeof x === 'string')
    if (strings) {
      if (A.length !== B.length) { if (JSON.stringify(A) !== JSON.stringify(B)) out.push({ path, before: A.join('\n') || null, after: B.join('\n') || null }); return }
      A.forEach((x, i) => { if (x !== B[i]) out.push({ path: `${path}/${i}`, before: String(x), after: String(B[i]) }) })
      return
    }
    const n = Math.max(A.length, B.length)
    for (let i = 0; i < n; i++) {
      if (i >= A.length) out.push({ path: `${path}/${i}`, before: null, after: summarize(B[i]) })
      else if (i >= B.length) out.push({ path: `${path}/${i}`, before: summarize(A[i]), after: null })
      else walk(A[i], B[i], `${path}/${i}`, out)
    }
    return
  }
  if (isObj(a) || isObj(b)) {
    const keys = new Set([...Object.keys(isObj(a) ? a : {}), ...Object.keys(isObj(b) ? b : {})])
    for (const k of keys) walk(isObj(a) ? a[k] : undefined, isObj(b) ? b[k] : undefined, `${path}/${k}`, out)
    return
  }
  const av = a === undefined || a === null ? '' : String(a), bv = b === undefined || b === null ? '' : String(b)
  if (av !== bv) out.push({ path, before: av || null, after: bv || null })
}

function summarize(v: unknown): string {
  if (typeof v === 'string') return v
  if (isObj(v)) return String(v.name ?? v.position ?? v.institution ?? v.title ?? v.language ?? JSON.stringify(v)).slice(0, 120)
  return JSON.stringify(v).slice(0, 120)
}

/** Attributable differences between two documents (normalised through the schema first). */
export function diffContent(base: ResumeContent, draft: ResumeContent): ContentChange[] {
  const out: ContentChange[] = []
  walk(ResumeContentSchema.parse(base), ResumeContentSchema.parse(draft), '', out)
  return out.filter((c) => c.path !== '/meta/sectionOrder' && c.before !== c.after)
}

export interface ChangeGrounding { path: string; result: GroundingResult }

/** Grounding flags for the strings a draft adds/changes relative to the master (+ confirmed facts). */
export function groundChanges(changes: ContentChange[], master: ResumeContent, confirmedFacts: string[] = []): ChangeGrounding[] {
  const out: ChangeGrounding[] = []
  for (const c of changes) {
    if (!c.after || c.after === c.before) continue
    // contact fields / dates / urls are not claims
    if (/^\/basics\/(name|email|phone|url|location|profiles)|Date$|\/url$|\/score$/.test(c.path)) continue
    // list changes (bullets/keywords joined with newlines): validate only the new/changed lines, one by one
    const beforeLines = new Set((c.before ?? '').split('\n').map((l) => l.trim()).filter(Boolean))
    const lines = c.after.includes('\n') ? c.after.split('\n').map((l) => l.trim()).filter((l) => l && !beforeLines.has(l)) : [c.after]
    const merged: GroundingResult = { ok: true, unsupported: [], checked: 0 }
    for (const line of lines) {
      const r = validateGrounding(line, { master, confirmedFacts, allow: c.before ? [c.before] : [] })
      merged.checked += r.checked
      if (!r.ok) { merged.ok = false; for (const u of r.unsupported) if (!merged.unsupported.some((x) => x.key === u.key)) merged.unsupported.push(u) }
    }
    if (!merged.ok) out.push({ path: c.path, result: merged })
  }
  return out
}

/** Bullets ↔ textarea text (one line = one bullet). */
export const bulletsToText = (items: string[]): string => items.join('\n')
export const textToBullets = (text: string): string[] => text.split(/\r?\n/).map((s) => s.replace(/^[-•*▪◦]\s+/, '').trim()).filter(Boolean)
/** Comma/newline separated keywords ↔ text. */
export const keywordsToText = (items: string[]): string => items.join(', ')
export const textToKeywords = (text: string): string[] => [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))]

/** Small JSON-pointer helpers for the editor's generic "edit path" reducer. */
export function getAt(obj: unknown, pointer: string): unknown {
  return pointer.split('/').slice(1).reduce<unknown>((cur, k) => (cur == null ? undefined : (cur as Record<string, unknown>)[k]), obj)
}
export function setAt<T>(obj: T, pointer: string, value: unknown): T {
  const c = structuredClone(obj) as unknown as Record<string, unknown>
  const parts = pointer.split('/').slice(1)
  let cur: Record<string, unknown> = c
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (cur[k] === undefined || cur[k] === null) cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
  return c as unknown as T
}
