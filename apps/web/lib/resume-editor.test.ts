import { describe, expect, it } from 'vitest'
import { ResumeContentSchema } from '@jobradar/resume/client'
import { analyzeJdDeterministic } from '@jobradar/resume'
import { SAMPLE_RESUME, SAMPLE_JD, SAMPLE_JD_TITLE } from '../../../packages/resume/src/__fixtures__/sample.js'
import { applySuggestion, canUndo, changes, createEditorState, editPath, liveScore, loadDraft, resetDraft, saveDraft, suggestionGains, undoSuggestion } from './resume-editor.js'
import type { Suggestion } from './api-client.js'

const base = ResumeContentSchema.parse(SAMPLE_RESUME)
const reqs = analyzeJdDeterministic(SAMPLE_JD_TITLE, SAMPLE_JD)
const sug = (o: Partial<Suggestion>): Suggestion => ({ id: 's1', reportId: 'r', kind: 'bullet_rewrite', targetPath: '/work/0/highlights/0', before: base.work[0].highlights[0], after: 'x', rationale: 'r', jdEvidence: null, skill: null, grounding: null, flagged: false, expectedGain: null, status: 'pending', userEdit: null, answer: null, variant: null, question: null, ...o })

describe('resume editor state (browser logic, tested headless)', () => {
  it('edits paths, tracks dirty/changes, resets', () => {
    let s = createEditorState(base)
    expect(s.dirty).toBe(false)
    s = editPath(s, '/basics/label', 'Principal Engineer')
    expect(s.dirty).toBe(true)
    expect(changes(s)).toEqual([{ path: '/basics/label', before: base.basics.label ?? null, after: 'Principal Engineer' }])
    s = resetDraft(s)
    expect(s.dirty).toBe(false)
    expect(changes(s)).toEqual([])
  })
  it('live score moves when a missing required skill is added, and suggestion gains are computed on the draft', () => {
    const s0 = createEditorState(base)
    const before = liveScore(s0.draft, reqs)!
    const missing = before.missing.find((m) => m.required)!
    const add = sug({ id: 'add', kind: 'skills_section', targetPath: null, before: null, after: missing.skill })
    const gains = suggestionGains(s0.draft, [add], reqs)
    expect(gains.add).toBeGreaterThan(0)
    const s1 = applySuggestion(s0, add)
    const after = liveScore(s1.draft, reqs)!
    expect(after.score - before.score).toBe(gains.add)
    expect(after.matched.some((m) => m.skill === missing.skill)).toBe(true)
    // once applied, the same suggestion gains nothing more
    expect(suggestionGains(s1.draft, [add], reqs).add).toBe(0)
  })
  it('applies a bullet rewrite, undoes it LIFO, refuses non-applicable kinds', () => {
    const s0 = createEditorState(base)
    const rewrite = sug({ id: 'rw', after: 'Rewrote the bullet with Kafka and PostgreSQL' })
    const skills = sug({ id: 'sk', kind: 'skills_section', targetPath: null, before: null, after: 'Terraform' })
    let s = applySuggestion(s0, rewrite)
    expect(s.draft.work[0].highlights[0]).toBe('Rewrote the bullet with Kafka and PostgreSQL')
    s = applySuggestion(s, skills)
    expect(canUndo(s, 'rw')).toBe(false) // not the last one
    expect(canUndo(s, 'sk')).toBe(true)
    expect(undoSuggestion(s, 'rw')).toBe(s) // no-op
    s = undoSuggestion(s, 'sk')
    expect(s.applied.map((a) => a.suggestionId)).toEqual(['rw'])
    s = undoSuggestion(s, 'rw')
    expect(s.draft.work[0].highlights[0]).toBe(base.work[0].highlights[0])
    expect(() => applySuggestion(s, sug({ id: 'q', kind: 'keyword_confirm' }))).toThrow(/cannot be applied/)
    // the target bullet was edited away → apply fails loudly instead of corrupting the draft
    const edited = editPath(s0, '/work/0/highlights', [])
    expect(() => applySuggestion(edited, rewrite)).toThrow()
  })
  it('drafts persist to storage only while dirty', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } }
    let s = createEditorState(base)
    saveDraft(storage, 'v1', 'j1', s)
    expect(loadDraft(storage, 'v1', 'j1')).toBeNull()
    s = editPath(s, '/basics/name', 'Edited Name')
    saveDraft(storage, 'v1', 'j1', s)
    expect(loadDraft(storage, 'v1', 'j1')!.draft.basics.name).toBe('Edited Name')
    expect(loadDraft(storage, 'v1', null)).toBeNull()
    const restored = createEditorState(base, loadDraft(storage, 'v1', 'j1')!.draft)
    expect(restored.dirty).toBe(true)
  })
})
