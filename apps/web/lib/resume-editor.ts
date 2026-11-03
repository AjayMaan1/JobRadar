import { ResumeContentSchema, applyProposal, diffContent, groundChanges, scoreResume, setAt } from '@jobradar/resume/client'
import type { AtsBreakdown, ChangeGrounding, ContentChange, JobRequirementsData, ParseWarning, Proposal, ResumeContent } from '@jobradar/resume/client'
import type { Suggestion } from './api-client'

/**
 * Visual editor state (docs/HLD-resume-editor.md §3). Pure functions over the draft document so the page
 * component stays thin and everything here is unit-testable without a browser:
 *   edit a JSON-pointer path · apply / undo a suggestion (LIFO) · live score · per-suggestion expected gain ·
 *   grounding flags for changed text · change log vs the base · localStorage draft persistence.
 */
export interface EditorState {
  base: ResumeContent
  draft: ResumeContent
  /** LIFO stack of applied suggestions with the draft snapshot taken right before each apply. */
  applied: Array<{ suggestionId: string; snapshot: ResumeContent }>
  dirty: boolean
  updatedAt: number
}

export const APPLICABLE_KINDS = new Set(['bullet_rewrite', 'skills_section', 'reorder', 'headline', 'about'])

export function createEditorState(base: ResumeContent, draft?: ResumeContent | null): EditorState {
  const b = ResumeContentSchema.parse(base)
  const d = draft ? ResumeContentSchema.parse(draft) : structuredClone(b)
  return { base: b, draft: d, applied: [], dirty: JSON.stringify(b) !== JSON.stringify(d), updatedAt: Date.now() }
}

export function editPath(state: EditorState, pointer: string, value: unknown): EditorState {
  const draft = setAt(state.draft, pointer, value)
  return { ...state, draft, dirty: true, updatedAt: Date.now() }
}

/** Replace the whole draft (array moves/removals are easier done by the form). */
export function replaceDraft(state: EditorState, draft: ResumeContent): EditorState {
  return { ...state, draft: ResumeContentSchema.parse(draft), dirty: true, updatedAt: Date.now() }
}

export function resetDraft(state: EditorState): EditorState {
  return { ...state, draft: structuredClone(state.base), applied: [], dirty: false, updatedAt: Date.now() }
}

export function toProposal(s: Suggestion): Proposal {
  return { kind: s.kind as Proposal['kind'], targetPath: s.targetPath, before: s.before, after: s.userEdit ?? s.after, rationale: s.rationale, skill: s.skill, variant: s.variant }
}

/** Apply a suggestion to the draft; throws when the target no longer exists (e.g. the bullet was edited away). */
export function applySuggestion(state: EditorState, s: Suggestion): EditorState {
  if (!APPLICABLE_KINDS.has(s.kind)) throw new Error(`Suggestion kind ${s.kind} cannot be applied to the document`)
  const p = toProposal(s)
  let draft: ResumeContent
  if (s.kind === 'headline' || s.kind === 'about') draft = setAt(state.draft, s.kind === 'headline' ? '/basics/label' : '/basics/summary', (p.after ?? '').trim())
  else draft = applyProposal(state.draft, p, p.after)
  return { ...state, draft, applied: [...state.applied, { suggestionId: s.id, snapshot: state.draft }], dirty: true, updatedAt: Date.now() }
}

/** Undo the most recently applied suggestion (LIFO). Returns the same state when it is not the last one. */
export function undoSuggestion(state: EditorState, suggestionId: string): EditorState {
  const last = state.applied[state.applied.length - 1]
  if (!last || last.suggestionId !== suggestionId) return state
  return { ...state, draft: last.snapshot, applied: state.applied.slice(0, -1), dirty: true, updatedAt: Date.now() }
}

export const isApplied = (state: EditorState, suggestionId: string): boolean => state.applied.some((a) => a.suggestionId === suggestionId)
export const canUndo = (state: EditorState, suggestionId: string): boolean => state.applied[state.applied.length - 1]?.suggestionId === suggestionId

export function liveScore(draft: ResumeContent, requirements: JobRequirementsData | null, warnings: ParseWarning[] = []): AtsBreakdown | null {
  if (!requirements) return null
  try { return scoreResume(draft, requirements, warnings) } catch { return null }
}

/** Expected gain of each pending, applicable suggestion against the CURRENT draft (not the original report). */
export function suggestionGains(draft: ResumeContent, suggestions: Suggestion[], requirements: JobRequirementsData | null, warnings: ParseWarning[] = []): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  const current = liveScore(draft, requirements, warnings)
  for (const s of suggestions) {
    if (!APPLICABLE_KINDS.has(s.kind) || !current) { out[s.id] = null; continue }
    try {
      const p = toProposal(s)
      const next = s.kind === 'headline' || s.kind === 'about' ? setAt(draft, s.kind === 'headline' ? '/basics/label' : '/basics/summary', (p.after ?? '').trim()) : applyProposal(draft, p, p.after)
      const after = liveScore(next, requirements, warnings)
      out[s.id] = after ? after.score - current.score : null
    } catch { out[s.id] = null }
  }
  return out
}

export function changes(state: EditorState): ContentChange[] {
  return diffContent(state.base, state.draft)
}

export function grounding(state: EditorState, master: ResumeContent, confirmedFacts: string[]): ChangeGrounding[] {
  return groundChanges(changes(state), master, confirmedFacts)
}

// ── draft persistence (localStorage) ──────────────────────────────────────────────────────────────────────
export const draftKey = (baseVersionId: string, jobId: string | null) => `jobradar:draft:${baseVersionId}:${jobId ?? 'master'}`

export function loadDraft(storage: Pick<Storage, 'getItem'>, baseVersionId: string, jobId: string | null): { draft: ResumeContent; applied: string[]; savedAt: number } | null {
  try {
    const raw = storage.getItem(draftKey(baseVersionId, jobId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { draft: unknown; applied?: string[]; savedAt?: number }
    return { draft: ResumeContentSchema.parse(parsed.draft), applied: parsed.applied ?? [], savedAt: parsed.savedAt ?? 0 }
  } catch { return null }
}

export function saveDraft(storage: Pick<Storage, 'setItem' | 'removeItem'>, baseVersionId: string, jobId: string | null, state: EditorState): void {
  if (!state.dirty) { storage.removeItem(draftKey(baseVersionId, jobId)); return }
  storage.setItem(draftKey(baseVersionId, jobId), JSON.stringify({ draft: state.draft, applied: state.applied.map((a) => a.suggestionId), savedAt: Date.now() }))
}

export function clearDraft(storage: Pick<Storage, 'removeItem'>, baseVersionId: string, jobId: string | null): void {
  storage.removeItem(draftKey(baseVersionId, jobId))
}
