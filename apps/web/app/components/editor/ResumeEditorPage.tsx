'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { renderAtsClassicHtml } from '@jobradar/resume/client'
import type { ChangeGrounding, JobRequirementsData, ParseWarning, ResumeContent } from '@jobradar/resume/client'
import { AppShell } from '../layout/AppShell'
import { apiClient } from '../../../lib/api-client'
import type { AtsReport, Suggestion } from '../../../lib/api-client'
import { applySuggestion, canUndo, changes as diffChanges, clearDraft, createEditorState, editPath, grounding as groundingOf, isApplied, liveScore, loadDraft, replaceDraft, resetDraft, saveDraft, suggestionGains, undoSuggestion, type EditorState } from '../../../lib/resume-editor'
import { EditorForm } from './EditorForm'
import { ScoreRail } from './ScoreRail'

/**
 * Visual resume editor (docs/HLD-resume-editor.md): structured form ‖ live preview ‖ live score + inline
 * suggestions. Everything reactive runs in the browser on the draft; "Save as version" persists an immutable
 * version (tailored for the job, or a correction of the resume) and renders it.
 */
export function ResumeEditorPage({ resumeId }: { resumeId: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const jobId = params.get('job')
  const baseParam = params.get('base')

  const [state, setState] = useState<EditorState | null>(null)
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [warnings, setWarnings] = useState<ParseWarning[]>([])
  const [master, setMaster] = useState<ResumeContent | null>(null)
  const [facts, setFacts] = useState<string[]>([])
  const [report, setReport] = useState<AtsReport | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const [note, setNote] = useState('')

  // ── load ─────────────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const detail = await apiClient.getResume(resumeId)
        if (!detail.current) throw new Error('This resume has not been parsed yet')
        let base = detail.current.content as ResumeContent
        let baseId = detail.current.id
        if (baseParam && baseParam !== baseId) { const v = await apiClient.getVersion(baseParam); if (!v.content) throw new Error('Base version has no content'); base = v.content as unknown as ResumeContent; baseId = v.id }
        const profile = await apiClient.getProfile().catch(() => null)
        const stored = typeof localStorage !== 'undefined' ? loadDraft(localStorage, baseId, jobId) : null
        if (cancelled) return
        setLabel(detail.resume.label)
        setBaseVersionId(baseId)
        setWarnings((detail.resume.parseWarnings as ParseWarning[]) ?? [])
        setMaster(detail.current.content as ResumeContent)
        setFacts(((profile?.profile?.confirmedFacts as string[] | undefined) ?? []).filter((f) => typeof f === 'string'))
        setState(createEditorState(base, stored?.draft ?? null))
        setRestoredDraft(Boolean(stored))
        if (jobId) {
          const r = await apiClient.getLatestReport(jobId)
          if (r.report) { setReport(r.report); setSuggestions((await apiClient.getSuggestions(r.report.id)).data) }
        }
      } catch (e) { if (!cancelled) setError((e as Error).message) }
    })()
    return () => { cancelled = true }
  }, [resumeId, jobId, baseParam])

  // ── autosave draft ───────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state || !baseVersionId) return
    const t = setTimeout(() => { saveDraft(localStorage, baseVersionId, jobId, state); if (state.dirty) setSavedAt(Date.now()) }, 400)
    return () => clearTimeout(t)
  }, [state, baseVersionId, jobId])

  // ── derived (debounced) ──────────────────────────────────────────────────────────────────────────────
  const [derived, setDerived] = useState<{ html: string; score: ReturnType<typeof liveScore>; gains: Record<string, number | null>; grounding: ChangeGrounding[]; changes: number }>({ html: '', score: null, gains: {}, grounding: [], changes: 0 })
  const reqs: JobRequirementsData | null = useMemo(() => (report?.requirements ? ({ ...report.requirements, extractorVersion: '', sections: {} } as unknown as JobRequirementsData) : null), [report])
  useEffect(() => {
    if (!state) return
    const t = setTimeout(() => {
      const pending = suggestions.filter((s) => s.status === 'pending' || isApplied(state, s.id))
      setDerived({
        html: renderAtsClassicHtml(state.draft),
        score: liveScore(state.draft, reqs, warnings),
        gains: suggestionGains(state.draft, pending, reqs, warnings),
        grounding: master ? groundingOf(state, master, facts) : [],
        changes: diffChanges(state).length,
      })
    }, 150)
    return () => clearTimeout(t)
  }, [state, reqs, warnings, suggestions, master, facts])

  // ── actions ──────────────────────────────────────────────────────────────────────────────────────────
  const onEdit = useCallback((pointer: string, value: unknown) => setState((s) => (s ? editPath(s, pointer, value) : s)), [])
  const onReplace = useCallback((draft: ResumeContent) => setState((s) => (s ? replaceDraft(s, draft) : s)), [])

  async function apply(s: Suggestion) {
    if (!state) return
    try {
      setState(applySuggestion(state, s))
      const updated = await apiClient.patchSuggestion(s.id, { status: 'accepted' })
      setSuggestions((list) => list.map((x) => (x.id === s.id ? updated : x)))
    } catch (e) { setError((e as Error).message) }
  }
  async function undo(s: Suggestion) {
    if (!state) return
    setState(undoSuggestion(state, s.id))
    const updated = await apiClient.patchSuggestion(s.id, { status: 'pending' }).catch(() => null)
    if (updated) setSuggestions((list) => list.map((x) => (x.id === s.id ? updated : x)))
  }
  async function reject(s: Suggestion) {
    const updated = await apiClient.patchSuggestion(s.id, { status: 'rejected' })
    setSuggestions((list) => list.map((x) => (x.id === s.id ? updated : x)))
  }
  async function confirm(s: Suggestion, yes: boolean, context?: string) {
    setBusy('Recording your answer…')
    try {
      const r = await apiClient.confirmFact(s.id, yes, context)
      if (r.taskId) await apiClient.waitTask(r.taskId).catch(() => undefined)
      if (report) setSuggestions((await apiClient.getSuggestions(report.id)).data)
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  async function generate() {
    if (!report) return
    setBusy('Generating suggestions…')
    try {
      const { taskId } = await apiClient.generateSuggestions(report.id)
      await apiClient.waitTask(taskId, (t) => setBusy(t.progress ?? 'Generating…'))
      setSuggestions((await apiClient.getSuggestions(report.id)).data)
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  async function analyse() {
    if (!jobId || !baseVersionId) return
    setBusy('Analysing match…')
    try {
      const { taskId } = await apiClient.startAnalysis(jobId, baseVersionId)
      const t = await apiClient.waitTask<{ reportId: string }>(taskId, (s) => setBusy(s.progress ?? 'Analysing…'))
      if (t.status === 'failed') throw new Error(t.error ?? 'Analysis failed')
      const r = await apiClient.getLatestReport(jobId)
      if (r.report) { setReport(r.report); setSuggestions((await apiClient.getSuggestions(r.report.id)).data) }
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  async function save() {
    if (!state || !baseVersionId) return
    setBusy('Saving version…'); setError(null)
    try {
      const r = await apiClient.createEditorVersion({ baseVersionId, jobId: jobId ?? undefined, content: state.draft, acceptedSuggestionIds: state.applied.map((a) => a.suggestionId), note: note || undefined })
      clearDraft(localStorage, baseVersionId, jobId)
      const t = await apiClient.waitTask<{ scoreBefore: number | null; scoreAfter: number | null }>(r.taskId, (s) => setBusy(s.progress ?? 'Rendering…'))
      if (t.status === 'failed') setError(`Saved as ${r.kind} version, but rendering failed: ${t.error ?? 'unknown'} — retry from the Tailor tab`)
      if (jobId) router.push(`/?job=${jobId}`)
      else router.push('/resumes')
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  if (error && !state) return <AppShell title="Resume editor"><p className="text-sm text-rose-600">{error}</p></AppShell>
  if (!state) return <AppShell title="Resume editor"><p className="text-sm text-slate-400">Loading…</p></AppShell>

  const baseScore = report?.score ?? null
  const live = derived.score?.score ?? null

  return (
    <AppShell
      fullBleed
      title={`Edit: ${label}`}
      subtitle={jobId && report ? `Tailoring for ${report.job.title} — ${report.job.company}` : jobId ? 'Tailoring for a job (run the match analysis to get a score and suggestions)' : 'Editing the master resume (saved as a correction; your profile is re-seeded from it)'}
      actions={
        <div className="flex items-center gap-2 text-xs">
          {busy && <span className="text-slate-500">{busy}</span>}
          {!busy && state.dirty && <span className="text-amber-700">{derived.changes} change{derived.changes === 1 ? '' : 's'}{savedAt ? ` · draft saved ${new Date(savedAt).toLocaleTimeString()}` : ''}</span>}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note for the change log" className="input input-sm w-44" />
          <a href={jobId ? `/?job=${jobId}` : '/resumes'} className="btn btn-ghost btn-sm">Back</a>
          <button disabled={!state.dirty || Boolean(busy)} onClick={() => { if (window.confirm('Discard all unsaved changes?')) { setState(resetDraft(state)); if (baseVersionId) clearDraft(localStorage, baseVersionId, jobId) } }} className="btn btn-secondary btn-sm">Discard draft</button>
          <button disabled={!state.dirty || Boolean(busy)} onClick={save} className="btn btn-primary btn-sm">{jobId ? 'Save as tailored version' : 'Save as new version'}</button>
        </div>
      }
    >
      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      {restoredDraft && <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">Restored your unsaved draft from this browser. <button onClick={() => { setState(resetDraft(state)); setRestoredDraft(false); if (baseVersionId) clearDraft(localStorage, baseVersionId, jobId) }} className="underline">Start from the saved version instead</button></div>}
      <div className={`grid gap-3 ${error || restoredDraft ? 'h-[calc(100vh-8.5rem)]' : 'h-[calc(100vh-5.5rem)]'} ${jobId ? 'grid-cols-[5fr_4fr_3fr]' : 'grid-cols-[5fr_4fr]'}`}>
        <div className="card min-h-0 overflow-y-auto p-4">
          <EditorForm draft={state.draft} onEdit={onEdit} onReplace={onReplace} grounding={derived.grounding} warnings={warnings} />
        </div>
        <div className="card flex min-h-0 flex-col overflow-hidden bg-slate-100">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500"><span className="font-medium text-slate-700">Live preview</span><span>ats-classic · same template as the PDF{live !== null ? ` · match ${live}` : ''}</span></div>
          <iframe title="preview" sandbox="" srcDoc={derived.html} className="min-h-0 w-full flex-1 bg-white" />
        </div>
        {jobId && (
          <div className="card min-h-0 overflow-y-auto p-4">
            <ScoreRail
              report={report}
              live={derived.score}
              baseScore={baseScore}
              suggestions={suggestions}
              gains={derived.gains}
              applied={(id) => isApplied(state, id)}
              undoable={(id) => canUndo(state, id)}
              grounding={derived.grounding}
              busy={Boolean(busy)}
              onApply={apply}
              onUndo={undo}
              onReject={reject}
              onConfirm={confirm}
              onGenerate={generate}
              onAnalyse={analyse}
            />
          </div>
        )}
      </div>
    </AppShell>
  )
}
