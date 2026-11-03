'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../../../lib/api-client'
import type { AtsReport, Job } from '../../../lib/api-client'
import { CLASS_LABEL } from '../../../lib/api-client'
import { Badge, Button, LinkButton } from '../ui'
import { formatRelativeDate, formatSalaryOrig, eligibilityLabel, eligibilityColor } from '../../../lib/formatters'
import { renderDescription } from '../../../lib/description'
import { ReportView } from './ReportView'
import { TailorTab } from './TailorTab'
import { ApplyKitPanel } from '../tailor/ApplyKitPanel'

type TabId = 'overview' | 'match' | 'tailor' | 'apply'

/**
 * Right-hand panel of the jobs workspace (U5). One place for the job, four tabs, a stepper that shows where
 * this job is in the workflow, and a single apply path (the Apply tab).
 */
export function JobDetailPanel({ job, onJobUpdated, onNext, onPrev }: { job: Job; onJobUpdated: (j: Job) => void; onNext?: () => void; onPrev?: () => void }) {
  const [tab, setTab] = useState<TabId>('overview')
  const [report, setReport] = useState<AtsReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsJd, setNeedsJd] = useState(false)
  const [noResume, setNoResume] = useState(false)
  const [jdText, setJdText] = useState('')
  const [showAll, setShowAll] = useState(false)

  // reset per job
  useEffect(() => {
    setTab('overview'); setReport(null); setError(null); setNeedsJd(false); setNoResume(false); setJdText(''); setShowAll(false)
    if (!job.progress?.analysed) return
    setReportLoading(true)
    apiClient.getLatestReport(job.id).then((r) => setReport(r.report)).catch(() => setReport(null)).finally(() => setReportLoading(false))
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /** One click: analyse, then generate suggestions (U7 — no separate waits). */
  const analyse = useCallback(async (withSuggestions = true) => {
    setRunning(true); setError(null); setNeedsJd(false); setNoResume(false); setProgress('Queued…')
    try {
      const { taskId } = await apiClient.startAnalysis(job.id)
      const t = await apiClient.waitTask<{ reportId: string }>(taskId, (s) => setProgress(s.progress ?? (s.status === 'queued' ? 'Waiting for worker…' : 'Analysing…')))
      if (t.status === 'failed') {
        if (t.error === 'needs_manual_jd') { setNeedsJd(true); setTab('match') } else setError(t.error ?? 'Analysis failed')
        return
      }
      const reportId = t.result?.reportId
      if (!reportId) return
      let r = await apiClient.getReport(reportId)
      setReport(r)
      setTab('match')
      if (withSuggestions) {
        setProgress('Generating suggestions…')
        const s = await apiClient.generateSuggestions(reportId)
        await apiClient.waitTask(s.taskId, (st) => setProgress(st.progress ?? 'Generating suggestions…'))
        r = await apiClient.getReport(reportId)
        setReport(r)
      }
      onJobUpdated({ ...job, progress: { ...(job.progress ?? { pendingSuggestions: 0, tailored: false, tailoredVersionId: null, applied: false }), analysed: true, reportScore: r.score, reportId: r.id } })
    } catch (err) {
      if ((err as { code?: string }).code === 'no_resume') setNoResume(true)
      else setError((err as Error).message)
    } finally {
      setRunning(false); setProgress(null)
    }
  }, [job, onJobUpdated])

  async function submitJd() {
    setRunning(true); setError(null); setProgress('Saving description…')
    try {
      const { taskId } = await apiClient.submitJobDescription(job.id, jdText)
      const t = await apiClient.waitTask(taskId, (s) => setProgress(s.progress ?? 'Extracting requirements…'))
      if (t.status === 'failed') { setError(t.error ?? 'Failed'); return }
      setNeedsJd(false)
      await analyse()
    } catch (err) { setError((err as Error).message) } finally { setRunning(false); setProgress(null) }
  }

  async function toggleSave() {
    const updated = await apiClient.saveJob(job.id)
    onJobUpdated({ ...job, ...updated, progress: job.progress, matchScore: job.matchScore, matchWhy: job.matchWhy, application: job.application })
  }
  async function reject() {
    const updated = await apiClient.rejectJob(job.id)
    onJobUpdated({ ...job, ...updated, progress: job.progress, matchScore: job.matchScore, matchWhy: job.matchWhy })
    onNext?.()
  }

  const p = job.progress
  const steps: Array<{ id: TabId; label: string; done: boolean; hint: string }> = [
    { id: 'match', label: 'Analysed', done: Boolean(p?.analysed || report), hint: report ? `match ${report.score}` : 'run the match analysis' },
    { id: 'tailor', label: 'Improved', done: Boolean(p?.analysed && p.pendingSuggestions === 0 && report), hint: p?.pendingSuggestions ? `${p.pendingSuggestions} to review` : 'accept or reject suggestions' },
    { id: 'tailor', label: 'Tailored', done: Boolean(p?.tailored), hint: p?.tailored ? 'PDF/DOCX ready' : 'generate a tailored version' },
    { id: 'apply', label: 'Applied', done: Boolean(p?.applied || job.userState === 'applied'), hint: job.application?.status ?? 'open the apply kit' },
  ]
  const applyUrl = job.applyUrl ?? job.sourceUrl

  return (
    <div data-smoke="job-detail" className="flex h-full flex-col">
      {/* header */}
      <div className="border-b border-slate-200 px-6 pb-4 pt-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold leading-tight text-slate-900">{job.title}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{job.company}{job.city || job.region ? ` · ${[job.city, job.region ?? job.country].filter(Boolean).join(', ')}` : ''}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {(onPrev || onNext) && <><Button variant="ghost" size="xs" onClick={onPrev} disabled={!onPrev} title="Previous (k / ↑)">↑</Button><Button variant="ghost" size="xs" onClick={onNext} disabled={!onNext} title="Next (j / ↓)">↓</Button></>}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          {job.fitScore !== null && job.fitScore !== undefined && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200" title="Semantic fit (fit-v1): how close this posting is to your profile in meaning">★ fit {job.fitScore}</span>}
          {job.matchScore !== null && job.matchScore !== undefined && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700" title="Exact keyword overlap — what an ATS keyword filter sees">⌨ ATS {job.matchScore}</span>}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600" title="JobRadar ranking: class + pay + fit + freshness">score {job.rankingScore}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{job.eval ? job.eval.tierLabel : CLASS_LABEL[job.opportunityClass]}</span>
          <span className={`rounded-full px-2 py-0.5 ${eligibilityColor(job.eligibility)}`}>{eligibilityLabel(job.eligibility)}</span>
          {(job.salaryMin || job.salaryInrMin) && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{formatSalaryOrig(job) || `₹${Math.round((job.salaryInrMin ?? 0) / 100000)}L+`}</span>}
          {job.employmentType === 'contract' && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">contract</span>}
          {job.remoteType && <span className="rounded-full bg-sky-50 px-2 py-0.5 capitalize text-sky-700">{job.remoteType}</span>}
          {job.closedAt && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">closed {formatRelativeDate(job.closedAt)}</span>}
          <span className="text-slate-400">· first seen {formatRelativeDate(job.firstSeenAt)} · {job.sourceName}</span>
        </div>
        {/* stepper */}
        <ol className="mt-3 flex items-center gap-0 text-[11px]">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center">
              <button onClick={() => setTab(s.id)} className="flex items-center gap-1.5" title={s.hint}>
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${s.done ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-400'}`}>{s.done ? '✓' : i + 1}</span>
                <span className={s.done ? 'text-slate-800' : 'text-slate-400'}>{s.label}</span>
              </button>
              {i < steps.length - 1 && <span className="mx-2 h-px w-6 bg-slate-200" />}
            </li>
          ))}
        </ol>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 px-6 text-sm">
        {([['overview', 'Overview'], ['match', 'Match'], ['tailor', 'Tailor'], ['apply', 'Apply']] as Array<[TabId, string]>).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-2.5 font-medium transition ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {label}{id === 'tailor' && p?.pendingSuggestions ? <span className="ml-1.5 rounded-full bg-indigo-600 px-1.5 text-[10px] text-white">{p.pendingSuggestions}</span> : null}
          </button>
        ))}
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === 'overview' && (
          <div className="space-y-5">
            {job.eval ? (
              <div className="rounded-md bg-slate-50 p-2.5 text-xs text-slate-600"><span className="font-medium text-slate-800">Why it&apos;s {job.eval.tier === 'none' ? 'not' : ''} in your feed:</span> {job.eval.tierLabel}{job.eval.reasons.length ? ` — ${job.eval.reasons.join(' · ')}` : ''}{!job.eval.eligible && job.remoteType === 'remote' ? ' · not eligible from your country' : ''} <a href="/preferences" className="ml-1 link">preferences</a></div>
            ) : job.classReason && (
              <div className="rounded-md bg-slate-50 p-2.5 text-xs text-slate-600"><span className="font-medium text-slate-800">Why it&apos;s in your feed:</span> {CLASS_LABEL[job.opportunityClass]} — {job.classReason}{job.eligibilityEvidence ? ` · evidence: “${job.eligibilityEvidence}”` : ''}</div>
            )}
            {job.matchWhy && (job.matchWhy.matched.length || job.matchWhy.missing.length) ? (
              <div className="rounded-md border border-emerald-100 bg-emerald-50/40 p-2.5 text-xs">
                <span className="font-medium text-slate-800">Quick match:</span>{' '}
                {job.matchWhy.matched.length > 0 && <span className="text-emerald-700">{job.matchWhy.matched.join(', ')} in your profile</span>}
                {job.matchWhy.missing.length > 0 && <span className="text-slate-600">{job.matchWhy.matched.length ? ' · ' : ''}not in your profile: {job.matchWhy.missing.join(', ')}</span>}
                {!report && <button onClick={() => analyse()} disabled={running} className="ml-2 link">Run the full analysis →</button>}
              </div>
            ) : null}
            {(job.skills ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1">{job.skills.map((s) => <span key={s} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">{s}</span>)}</div>
            )}
            {job.descriptionSource === 'manual' && <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">This description was pasted by a user{job.descriptionManualAt ? ` on ${new Date(job.descriptionManualAt).toLocaleDateString('en-IN')}` : ''} because the posting could not be fetched — verify against the original before relying on it.</p>}
            <div>{renderDescription(job.description)}</div>
            {applyUrl && <a href={applyUrl} target="_blank" rel="noreferrer" className="text-xs link">View original posting ↗</a>}
          </div>
        )}

        {tab === 'match' && (
          <div className="space-y-3">
            {noResume ? (
              <p className="text-sm text-slate-600">Upload a resume first on the <Link href="/profile" className="text-indigo-600 underline">Profile &amp; Resumes</Link> page.</p>
            ) : needsJd ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-700">We couldn&apos;t fetch a usable description for this posting. Paste it to continue:</p>
                <textarea value={jdText} onChange={(e) => setJdText(e.target.value)} rows={8} className="input" placeholder="Paste the full job description…" />
                <button onClick={submitJd} disabled={running || jdText.trim().length < 200} className="btn btn-primary btn-sm">Save &amp; analyse</button>
              </div>
            ) : reportLoading ? (
              <p className="text-xs text-slate-400">Loading report…</p>
            ) : report ? (
              <>
                <p className="text-[11px] text-slate-400">JobRadar estimate · {report.resumeVersion.label} · {report.scorerVersion} · {formatRelativeDate(report.createdAt)} <button onClick={() => analyse(false)} disabled={running} className="ml-2 link">re-analyse</button></p>
                {report.breakdown.semantic && <SemanticBlock s={report.breakdown.semantic} atsScore={report.score} />}
                <ReportView report={report} showAll={showAll} onToggleAll={() => setShowAll((v) => !v)} />
              </>
            ) : (
              <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                Run the match analysis to see how your master resume scores against this posting, what&apos;s missing, and get grounded suggestions.
                <div className="mt-2"><button onClick={() => analyse()} disabled={running} className="btn btn-primary btn-sm">{running ? progress ?? 'Working…' : 'Analyse & suggest'}</button></div>
              </div>
            )}
            {error && <p className="text-xs text-rose-600">{error}</p>}
          </div>
        )}

        {tab === 'tailor' && (report ? <TailorTab job={job} report={report} onReport={setReport} /> : <p className="text-sm text-slate-500">Run the match analysis first (Match tab).</p>)}

        {tab === 'apply' && <ApplyKitPanel job={job} reportId={report?.id ?? job.progress?.reportId ?? null} onApplied={(j) => onJobUpdated({ ...job, ...j, matchScore: job.matchScore, matchWhy: job.matchWhy, progress: { ...(job.progress ?? { analysed: false, reportScore: null, reportId: null, pendingSuggestions: 0, tailored: false, tailoredVersionId: null }), applied: true } })} />}
      </div>

      {/* footer actions */}
      <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-5 py-2.5">
        <button onClick={toggleSave} disabled={job.userState === 'applied'} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${job.userState === 'saved' ? 'bg-amber-100 text-amber-800' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'} disabled:opacity-40`}>{job.userState === 'saved' ? '★ Saved' : '☆ Save'}</button>
        {job.userState !== 'rejected' && <button onClick={reject} className="btn btn-danger btn-sm">✗ Not interested</button>}
        <span className="ml-auto flex items-center gap-2">
          {running && <span className="text-[11px] text-slate-500">{progress}</span>}
          {!report && !noResume && <button onClick={() => analyse()} disabled={running} className="btn btn-primary btn-sm">{running ? 'Working…' : 'Analyse & suggest'}</button>}
          {report && <button onClick={() => setTab('apply')} className="btn btn-primary btn-sm">Apply kit →</button>}
        </span>
      </div>
    </div>
  )
}

/** C13: the two views side by side, plus "not named but covered by" evidence. */
function SemanticBlock({ s, atsScore }: { s: NonNullable<AtsReport['breakdown']['semantic']>; atsScore: number }) {
  const gap = s.fitScore !== null ? s.fitScore - atsScore : null
  const verdict =
    gap === null ? null
    : gap >= 15 ? 'You fit this role better than the keywords show — make the exact terms explicit so ATS filters see it.'
    : gap <= -15 ? 'The keywords are present but the substance is thinner — expect a recruiter to probe depth.'
    : 'Meaning and keywords agree.'
  return (
    <div className="rounded-md border border-violet-100 bg-violet-50/40 p-3 text-xs">
      <div className="flex items-center gap-4">
        <div><span className="text-[10px] uppercase tracking-wide text-slate-500">Semantic fit</span><div className="text-xl font-bold text-violet-700">{s.fitScore ?? '–'}</div></div>
        <div><span className="text-[10px] uppercase tracking-wide text-slate-500">ATS keyword</span><div className="text-xl font-bold text-slate-800">{atsScore}</div></div>
        {verdict && <p className="flex-1 text-slate-700">{verdict}</p>}
      </div>
      {s.topMatches.length > 0 && <p className="mt-2 text-[11px] text-slate-500">Closest to your profile: {s.topMatches.slice(0, 2).map((m) => `“${m.text.slice(0, 90)}…”`).join(' · ')}</p>}
      {s.evidence.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 font-medium text-slate-700">Not named, but your experience covers it</p>
          <ul className="space-y-1">
            {s.evidence.map((e) => <li key={e.skill}><span className="rounded border border-violet-200 bg-white px-1.5 py-0.5 text-violet-700">{e.skill}</span> <span className="text-slate-600">≈ “{e.text.replace(/^.*?: /, '').slice(0, 140)}”</span> <span className="text-slate-400">({Math.round(e.similarity * 100)}%)</span></li>)}
          </ul>
          <p className="mt-1 text-[11px] text-slate-500">Keyword filters only see exact terms — the Tailor tab asks you to confirm each of these before adding the word.</p>
        </div>
      )}
      <p className="mt-2 text-[10px] text-slate-400">{s.version} · {s.model} · local embeddings, nothing leaves this machine</p>
    </div>
  )
}
