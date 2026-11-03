'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '../../../lib/api-client'
import type { ApplyKit, Job } from '../../../lib/api-client'

function CopyBlock({ label, text }: { label: string; text: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!text) return null
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }} className="text-[11px] link">{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
      <p className="whitespace-pre-wrap text-xs text-slate-800">{text}</p>
    </div>
  )
}

/**
 * Apply Kit (backlog C10): files + copy-ready texts + drafted answers + "Open application" + "Mark applied".
 * The final Submit always happens on the employer's site (HLD V5).
 */
export function ApplyKitPanel({ job, reportId, onApplied }: { job: Job; reportId: string | null; onApplied: (j: Job) => void }) {
  const [kit, setKit] = useState<ApplyKit | null>(null)
  const [loading, setLoading] = useState(true)
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [coverNote, setCoverNote] = useState('')
  const [coverTone, setCoverTone] = useState<'conservative' | 'balanced' | 'assertive'>('balanced')
  const [followUpDays, setFollowUpDays] = useState<number>(7)

  const reload = async () => {
    const k = await apiClient.getApplyKit(job.id)
    setKit(k)
    setAnswers(Object.fromEntries(k.answers.filter((a) => a.status !== 'rejected' && a.question).map((a) => [a.question!, a.answer ?? ''])))
    setCoverNote((prev) => prev || k.coverLetter?.text || k.application?.coverNote || '')
  }

  async function draftCover() {
    if (!reportId) return
    setBusy(true); setError(null); setProgress('Queued…')
    try {
      const { taskId } = await apiClient.draftCoverLetter(reportId, coverTone)
      const t = await apiClient.waitTask(taskId, (s) => setProgress(s.progress ?? 'Drafting…'))
      if (t.status === 'failed') setError(t.error ?? 'Failed')
      setCoverNote('')
      await reload()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false); setProgress(null) }
  }
  useEffect(() => { setLoading(true); reload().catch(() => setKit(null)).finally(() => setLoading(false)) }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function draft() {
    if (!reportId) return
    setBusy(true); setError(null); setProgress('Queued…')
    try {
      const { taskId } = await apiClient.draftAnswers(reportId)
      const t = await apiClient.waitTask(taskId, (s) => setProgress(s.progress ?? 'Drafting…'))
      if (t.status === 'failed') setError(t.error ?? 'Failed')
      await reload()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false); setProgress(null) }
  }

  function openApplication() {
    if (!kit?.job.applyUrl) return
    window.open(kit.job.applyUrl, '_blank', 'noopener,noreferrer')
    setOpened(true)
  }

  async function markApplied() {
    if (!kit) return
    setBusy(true); setError(null)
    try {
      const updated = await apiClient.recordApplication(job.id, {
        resumeVersionId: kit.version?.id ?? kit.masterVersionId ?? null,
        headlineUsed: kit.texts.headline,
        aboutUsed: kit.texts.about,
        coverNote: coverNote || null,
        answers: Object.entries(answers).filter(([, a]) => a.trim()).map(([question, answer]) => ({ question, answer })),
        ...(followUpDays > 0 ? { followUpInDays: followUpDays } : {}),
      })
      onApplied(updated)
      await reload()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  if (loading) return <p className="text-xs text-slate-400">Loading apply kit…</p>
  if (!kit) return <p className="text-xs text-rose-600">Could not load the apply kit.</p>

  const app = kit.application
  return (
    <div className="space-y-3">
      <div className="rounded-md bg-slate-50 p-2.5 text-xs text-slate-600">
        <span className="font-medium text-slate-800 capitalize">{kit.job.ats}</span> · {kit.job.atsNote}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-slate-700">Resume to attach</p>
        {kit.version ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-600">Tailored version{kit.version.score !== null ? ` · match ${kit.version.score}` : ''}{kit.version.tailoredHeadline ? ' · tailored headline' : ''}{kit.version.tailoredAbout ? ' · tailored about' : ''}</span>
            {kit.files.pdf && <a href={kit.files.pdf} target="_blank" rel="noreferrer" className="btn btn-primary btn-md">Download PDF</a>}
            {kit.files.docx && <a href={kit.files.docx} target="_blank" rel="noreferrer" className="btn btn-secondary btn-md">Download DOCX</a>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">No tailored version yet — generate one above, or use your original file.</span>
            {kit.files.original && <a href={kit.files.original} target="_blank" rel="noreferrer" className="btn btn-secondary btn-md">Original ({kit.files.originalName})</a>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2">
        <CopyBlock label={`Headline${kit.texts.headlineIsTailored ? ' (tailored)' : ''}`} text={kit.texts.headline} />
        <CopyBlock label={`About / summary${kit.texts.aboutIsTailored ? ' (tailored)' : ''}`} text={kit.texts.about} />
        {kit.applyDefaults.noticePeriod && <CopyBlock label="Notice period" text={kit.applyDefaults.noticePeriod} />}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-700">Application questions {kit.questions.length ? <span className="text-slate-400">({kit.questions.length} from the posting)</span> : <span className="text-slate-400">(none published — a “why this role” note is drafted instead)</span>}</p>
          <button disabled={busy || !reportId} onClick={draft} className="btn btn-secondary btn-xs" title={reportId ? '' : 'Run the match analysis first'}>{busy ? progress ?? 'Working…' : kit.answers.length ? 'Re-draft answers' : 'Draft answers'}</button>
        </div>
        {kit.answers.length > 0 && (
          <div className="space-y-2">
            {kit.answers.filter((a) => a.question).map((a) => (
              <div key={a.id} className="rounded-md border border-slate-200 p-2">
                <p className="mb-1 text-[11px] font-medium text-slate-600">{a.question}{a.flagged && <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-1 text-amber-800">check facts</span>}</p>
                <textarea value={answers[a.question!] ?? ''} onChange={(e) => setAnswers((x) => ({ ...x, [a.question!]: e.target.value }))} rows={3} className="input input-sm" />
                <div className="mt-1 flex justify-end"><button onClick={() => navigator.clipboard.writeText(answers[a.question!] ?? '')} className="text-[11px] link">Copy</button></div>
              </div>
            ))}
          </div>
        )}
        {kit.questions.filter((q) => !kit.answers.some((a) => a.question === q.label) && !/resume|cv|upload|attach/i.test(q.label)).length > 0 && (
          <ul className="mt-2 list-disc pl-4 text-[11px] text-slate-500">
            {kit.questions.filter((q) => !kit.answers.some((a) => a.question === q.label) && !/resume|cv|upload|attach/i.test(q.label)).map((q) => <li key={q.label}>{q.label}{q.required ? ' *' : ''}{q.options?.length ? ` (${q.options.slice(0, 4).join(' / ')}${q.options.length > 4 ? '…' : ''})` : ''}</li>)}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-700">Cover note <span className="text-slate-400">(optional, recorded with the application)</span>{kit.coverLetter?.flagged && <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-1 text-[10px] text-amber-800">check facts</span>}</p>
          <div className="flex items-center gap-1">
            <select value={coverTone} onChange={(e) => setCoverTone(e.target.value as 'balanced')} className="input input-sm"><option value="conservative">conservative</option><option value="balanced">balanced</option><option value="assertive">assertive</option></select>
            <button disabled={busy || !reportId} onClick={draftCover} className="btn btn-secondary btn-xs" title={reportId ? 'Grounded in your resume — review before sending' : 'Run the match analysis first'}>{busy ? progress ?? 'Working…' : kit.coverLetter ? 'Re-draft note' : 'Draft note'}</button>
          </div>
        </div>
        <textarea value={coverNote} onChange={(e) => setCoverNote(e.target.value)} rows={coverNote ? 6 : 2} className="input input-sm" />
        {coverNote && <div className="mt-1 flex justify-end"><button onClick={() => navigator.clipboard.writeText(coverNote)} className="text-[11px] link">Copy</button></div>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {kit.job.applyUrl ? (
          <button onClick={openApplication} className="btn btn-primary btn-md">Open application ↗</button>
        ) : (
          <span className="text-xs text-slate-400">No apply link for this job.</span>
        )}
        {app ? (
          <span className="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">✓ Applied {app.appliedAt ? new Date(app.appliedAt).toLocaleDateString('en-IN') : ''}{app.resumeVersionId === kit.version?.id ? ' with this version' : ''}</span>
        ) : (
          <>
            <button disabled={busy || (!opened && Boolean(kit.job.applyUrl))} onClick={markApplied} title={opened || !kit.job.applyUrl ? '' : 'Open the application first'} className="btn btn-primary btn-md">✓ Mark as applied</button>
            <label className="flex items-center gap-1 text-[11px] text-slate-500">remind me in
              <select value={followUpDays} onChange={(e) => setFollowUpDays(Number(e.target.value))} className="input input-sm"><option value={0}>never</option><option value={5}>5 days</option><option value={7}>7 days</option><option value={10}>10 days</option><option value={14}>14 days</option></select>
            </label>
          </>
        )}
        {app && (
          <label className="flex items-center gap-1 text-[11px] text-slate-500">follow-up
            <input type="date" value={app.followUpAt ? app.followUpAt.slice(0, 10) : ''} onChange={async (e) => { const j = await apiClient.recordApplication(job.id, { status: app.status, followUpAt: e.target.value ? new Date(e.target.value).toISOString() : null }); onApplied(j); await reload() }} className="input input-sm" />
          </label>
        )}
        {app && (
          <select value={app.status} onChange={async (e) => { const j = await apiClient.recordApplication(job.id, { status: e.target.value }); onApplied(j); await reload() }} className="input input-sm ml-auto">
            {['applied', 'interviewing', 'offer', 'rejected', 'withdrawn'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <p className="text-[11px] text-slate-400">The submit button lives on the employer&apos;s site. JobRadar records which resume version and texts you used.</p>
    </div>
  )
}
