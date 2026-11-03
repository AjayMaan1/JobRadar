'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '../../../lib/api-client'
import type { AtsReport, Job, ResumeVersionDetail, Suggestion } from '../../../lib/api-client'
import { SuggestionList } from '../tailor/SuggestionList'
import { HeadlineAbout } from '../tailor/HeadlineAbout'

/** Steps 2–4: suggestions → opt-in headline/about → generate tailored version → before/after + preview. */
export function TailorTab({ job, report, onReport }: { job: Job; report: AtsReport; onReport: (r: AtsReport) => void }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [headline, setHeadline] = useState<string | null>(null)
  const [about, setAbout] = useState<string | null>(null)
  const [version, setVersion] = useState<ResumeVersionDetail | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const loadSuggestions = async () => { const r = await apiClient.getSuggestions(report.id); setSuggestions(r.data) }
  useEffect(() => { loadSuggestions().catch(() => setSuggestions([])) }, [report.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function generateSuggestions() {
    setBusy(true); setError(null); setProgress('Queued…')
    try {
      const { taskId } = await apiClient.generateSuggestions(report.id)
      const t = await apiClient.waitTask(taskId, (s) => setProgress(s.progress ?? 'Working…'))
      if (t.status === 'failed') setError(t.error ?? 'Failed')
      await loadSuggestions()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false); setProgress(null) }
  }

  async function onConfirmed(r: { created: Suggestion[]; taskId: string | null }) {
    await loadSuggestions()
    if (r.taskId) {
      setBusy(true); setProgress('Drafting a bullet from your confirmation…')
      try { await apiClient.waitTask(r.taskId); await loadSuggestions() } catch { /* shown on next load */ } finally { setBusy(false); setProgress(null) }
    }
  }

  const accepted = suggestions.filter((s) => (s.status === 'accepted' || s.status === 'edited') && !['keyword_confirm', 'formatting', 'answer', 'headline', 'about'].includes(s.kind))
  const canGenerate = accepted.length > 0 || headline !== null || about !== null

  async function generateVersion() {
    setBusy(true); setError(null); setProgress('Creating version…')
    try {
      const { versionId, taskId } = await apiClient.createVersion({ baseVersionId: report.resumeVersion.id, jobId: job.id, acceptedSuggestionIds: accepted.map((s) => s.id), headline, about })
      const t = await apiClient.waitTask(taskId, (s) => setProgress(s.progress ?? 'Rendering…'))
      const v = await apiClient.getVersion(versionId)
      setVersion(v)
      if (t.status === 'failed') setError(t.error ?? 'Render failed')
      else if (v.changeLog?.reportId) onReport(await apiClient.getReport(v.changeLog.reportId))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false); setProgress(null) }
  }

  const variants = (kind: 'headline' | 'about') => suggestions.filter((s) => s.kind === kind)
  const masterLabel = report.breakdown.details.titlesResume[0] ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Improve <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">nothing changes without your approval</span>
          <a href={`/resumes/${report.resumeVersion.resumeId}/edit?job=${job.id}&base=${report.resumeVersion.id}`} className="btn btn-secondary btn-xs ml-3 font-normal" title="Edit the resume with a live preview and the live score; apply these suggestions in place">✎ Open in editor</a></p>
        <button disabled={busy} onClick={generateSuggestions} className="btn btn-secondary btn-sm">{busy ? progress ?? 'Working…' : suggestions.length ? 'Regenerate suggestions' : 'Get suggestions'}</button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <SuggestionList suggestions={suggestions} onChanged={(s) => setSuggestions((all) => all.map((x) => (x.id === s.id ? s : x)))} onConfirmed={onConfirmed} />

      <div className="space-y-2">
        <HeadlineAbout reportId={report.id} kind="headline" masterText={masterLabel} variants={variants('headline')} chosen={headline} onChoose={setHeadline} onVariants={loadSuggestions} />
        <HeadlineAbout reportId={report.id} kind="about" masterText={null} variants={variants('about')} chosen={about} onChoose={setAbout} onVariants={loadSuggestions} />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md bg-slate-50 p-3">
        <button disabled={busy || !canGenerate} onClick={generateVersion} className="btn btn-primary btn-md" title={canGenerate ? '' : 'Accept at least one suggestion or choose a tailored headline/about'}>
          {busy && progress ? progress : 'Generate tailored resume'}
        </button>
        <span className="text-xs text-slate-500">{accepted.length} change(s){headline !== null ? ' + headline' : ''}{about !== null ? ' + about' : ''} → new immutable version, PDF + DOCX, verified and re-scored.</span>
      </div>

      {version && (
        <div className="rounded-md border border-slate-200 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-slate-800">Tailored version</span>
            {version.renderStatus === 'rendered' ? (
              <span className="text-slate-700">Match {version.changeLog?.scoreBefore ?? '?'} → <span className="font-semibold text-emerald-700">{version.changeLog?.scoreAfter ?? '?'}</span></span>
            ) : version.renderStatus === 'failed' ? (
              <span className="text-rose-600">Render failed: {version.renderError}</span>
            ) : (
              <span className="text-slate-500">Rendering…</span>
            )}
            {version.renderStatus === 'rendered' && (
              <>
                <a href={`/api/resume-versions/${version.id}/file?fmt=pdf`} target="_blank" rel="noreferrer" className="btn btn-primary btn-xs">PDF</a>
                <a href={`/api/resume-versions/${version.id}/file?fmt=docx`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-xs">DOCX</a>
                <button onClick={() => setShowPreview((v) => !v)} className="text-xs link">{showPreview ? 'Hide preview' : 'Preview'}</button>
              </>
            )}
            {version.renderStatus === 'failed' && <button onClick={async () => { const { taskId } = await apiClient.rerenderVersion(version.id); await apiClient.waitTask(taskId); setVersion(await apiClient.getVersion(version.id)) }} className="text-xs link">Retry</button>}
          </div>
          {version.renderWarnings && version.renderWarnings.length > 0 && <p className="text-[11px] text-amber-700">Rendered PDF warnings: {version.renderWarnings.map((w) => w.code).join(', ')}</p>}
          {version.changeLog?.changes && version.changeLog.changes.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">{version.changeLog.changes.length} change(s) vs your master</summary>
              <ul className="mt-1 space-y-1">
                {version.changeLog.changes.map((c, i) => <li key={i}><span className="rounded bg-slate-100 px-1 text-[10px]">{c.kind}</span> {c.before ? <span className="line-through text-slate-400">{c.before.slice(0, 80)}</span> : null} → {c.after.slice(0, 120)}</li>)}
              </ul>
            </details>
          )}
          {showPreview && <iframe title="preview" src={`/api/resume-versions/${version.id}/preview`} sandbox="" className="h-[70vh] w-full rounded border border-slate-200 bg-white" />}
        </div>
      )}
    </div>
  )
}

