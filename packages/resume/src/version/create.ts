import type { Suggestion } from '@jobradar/db'
import { ResumeContentSchema, type ResumeContent } from '../schema/resume.js'
import { applyProposal } from '../suggest/apply.js'
import type { Proposal } from '../suggest/types.js'

export interface AppliedChange {
  suggestionId: string
  kind: string
  targetPath: string | null
  before: string | null
  after: string
}

export interface TailorInput {
  base: ResumeContent
  accepted: Suggestion[]
  /** Chosen (possibly edited) headline/about for THIS application; undefined = keep master text. */
  headline?: string | null
  about?: string | null
}

/**
 * Build tailored content from the base version + accepted/edited suggestions (C9-1). Pure; returns the
 * change log that is stored on the version so every difference to the parent is attributable.
 */
export function buildTailoredContent(input: TailorInput): { content: ResumeContent; changes: AppliedChange[] } {
  let content = structuredClone(input.base)
  const changes: AppliedChange[] = []
  // apply in a stable order so bullet indexes written by earlier suggestions stay valid: reorders last
  const order = (s: Suggestion) => (s.kind === 'reorder' ? 2 : s.kind === 'skills_section' ? 1 : 0)
  for (const s of [...input.accepted].sort((a, b) => order(a) - order(b))) {
    if (!['accepted', 'edited'].includes(s.status)) continue
    if (['keyword_confirm', 'formatting', 'answer', 'headline', 'about'].includes(s.kind)) continue
    const text = s.status === 'edited' ? s.userEdit ?? s.after : s.userEdit ?? s.after
    if (!text) continue
    const p: Proposal = { kind: s.kind as Proposal['kind'], targetPath: s.targetPath, before: s.before, after: text, rationale: s.rationale }
    content = applyProposal(content, p, text)
    changes.push({ suggestionId: s.id, kind: s.kind, targetPath: s.targetPath, before: s.before, after: text })
  }
  if (input.headline !== undefined && input.headline !== null) {
    changes.push({ suggestionId: '', kind: 'headline', targetPath: '/basics/label', before: content.basics.label ?? null, after: input.headline })
    content.basics.label = input.headline
  }
  if (input.about !== undefined && input.about !== null) {
    changes.push({ suggestionId: '', kind: 'about', targetPath: '/basics/summary', before: content.basics.summary ?? null, after: input.about })
    content.basics.summary = input.about
  }
  return { content: ResumeContentSchema.parse(content), changes }
}
