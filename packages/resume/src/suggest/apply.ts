import { ResumeContentSchema, type ResumeContent } from '../schema/resume.js'
import { canonicalizeSkill } from '../skills/aliases.js'
import type { Proposal } from './types.js'

/** Read a JSON pointer ("/work/0/highlights/2"). */
export function getPointer(obj: unknown, path: string): unknown {
  if (!path || path === '/') return obj
  let cur: unknown = obj
  for (const raw of path.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (cur === null || typeof cur !== 'object') return undefined
    cur = Array.isArray(cur) ? cur[Number(key)] : (cur as Record<string, unknown>)[key]
  }
  return cur
}

export function setPointer(obj: unknown, path: string, value: unknown): void {
  const parts = path.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
  let cur: unknown = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    const next = Array.isArray(cur) ? (cur as unknown[])[Number(key)] : (cur as Record<string, unknown>)[key]
    if (next === undefined || next === null) throw new Error(`Path not found: ${path}`)
    cur = next
  }
  const last = parts[parts.length - 1]
  if (Array.isArray(cur)) {
    const i = Number(last)
    if (!Number.isInteger(i) || i < 0 || i > cur.length) throw new Error(`Bad index in ${path}`)
    cur[i] = value
  } else if (cur && typeof cur === 'object') (cur as Record<string, unknown>)[last] = value
  else throw new Error(`Cannot set ${path}`)
}

/**
 * Apply one accepted proposal to a COPY of the content. `text` is the user's edit when present, else `after`.
 * Unknown/no-op kinds (formatting, keyword_confirm, answer) return the content unchanged.
 */
export function applyProposal(content: ResumeContent, p: Proposal, text?: string | null): ResumeContent {
  const c = structuredClone(content)
  const value = (text ?? p.after ?? '').trim()
  switch (p.kind) {
    case 'bullet_rewrite': {
      if (!p.targetPath) throw new Error('bullet_rewrite needs targetPath')
      if (typeof getPointer(c, p.targetPath) !== 'string') throw new Error(`Target is not a string: ${p.targetPath}`)
      setPointer(c, p.targetPath, value)
      break
    }
    case 'reorder': {
      if (!p.targetPath) throw new Error('reorder needs targetPath')
      const cur = getPointer(c, p.targetPath)
      if (!Array.isArray(cur)) throw new Error(`Target is not an array: ${p.targetPath}`)
      let order: unknown
      try { order = JSON.parse(value) } catch { throw new Error('reorder payload must be a JSON array') }
      if (!Array.isArray(order) || order.length !== cur.length || [...order].sort().join('\u0000') !== [...cur].sort().join('\u0000')) throw new Error('reorder must be a permutation of the existing items')
      setPointer(c, p.targetPath, order)
      break
    }
    case 'skills_section': {
      const add = value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
      if (!add.length) break
      let group = p.targetPath ? (getPointer(c, p.targetPath) as ResumeContent['skills'][number] | undefined) : undefined
      if (!group || !Array.isArray(group.keywords)) {
        if (!c.skills.length) c.skills.push({ name: 'Skills', keywords: [] })
        group = c.skills[c.skills.length - 1]
      }
      const have = new Set(group.keywords.map((k) => canonicalizeSkill(k).toLowerCase()))
      for (const s of add) if (!have.has(canonicalizeSkill(s).toLowerCase())) { group.keywords.push(s); have.add(canonicalizeSkill(s).toLowerCase()) }
      break
    }
    case 'headline':
      c.basics.label = value
      break
    case 'about':
      c.basics.summary = value
      break
    default:
      break
  }
  return ResumeContentSchema.parse(c)
}
