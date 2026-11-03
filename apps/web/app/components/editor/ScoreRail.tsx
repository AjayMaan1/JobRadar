'use client'

import { useState } from 'react'
import type { AtsBreakdown, ChangeGrounding } from '@jobradar/resume/client'
import type { AtsReport, Suggestion } from '../../../lib/api-client'

const COMPONENT_LABEL: Record<string, string> = { requiredSkills: 'Required skills', preferredSkills: 'Preferred skills', title: 'Title', experience: 'Experience', parseability: 'Parseability', quality: 'Quality', keywords: 'Domain keywords' }
const KIND_LABEL: Record<string, string> = { bullet_rewrite: 'Rewrite bullet', skills_section: 'Add to skills', reorder: 'Reorder', headline: 'Headline', about: 'About', keyword_confirm: 'Question', formatting: 'Formatting', answer: 'Answer', cover_letter: 'Cover note' }

interface Props {
  report: AtsReport | null
  live: AtsBreakdown | null
  baseScore: number | null
  suggestions: Suggestion[]
  gains: Record<string, number | null>
  applied: (id: string) => boolean
  undoable: (id: string) => boolean
  grounding: ChangeGrounding[]
  busy: boolean
  onApply: (s: Suggestion) => void
  onUndo: (s: Suggestion) => void
  onReject: (s: Suggestion) => void
  onConfirm: (s: Suggestion, yes: boolean, context?: string) => void
  onGenerate: () => void
  onAnalyse: () => void
}

/** Right rail: live score vs the base report, component bars, matched/missing chips, inline suggestions. */
export function ScoreRail({ report, live, baseScore, suggestions, gains, applied, undoable, grounding, busy, onApply, onUndo, onReject, onConfirm, onGenerate, onAnalyse }: Props) {
  const [ctx, setCtx] = useState<Record<string, string>>({})
  if (!report) {
    return (
      <div className="text-xs text-slate-600">
        <p className="mb-2 font-semibold text-slate-800">No match report for this job yet.</p>
        <p className="mb-3">Run the analysis to get the ATS score, matched/missing skills and grounded suggestions you can apply here as you edit.</p>
        <button disabled={busy} onClick={onAnalyse} className="btn btn-primary btn-sm">Analyse match</button>
      </div>
    )
  }
  const score = live?.score ?? report.score
  const delta = baseScore !== null ? score - baseScore : 0
  const pending = suggestions.filter((s) => s.status === 'pending' && !applied(s.id))
  const appliedList = suggestions.filter((s) => applied(s.id))
  const questions = pending.filter((s) => s.kind === 'keyword_confirm')
  const actionable = pending.filter((s) => ['bullet_rewrite', 'skills_section', 'reorder', 'headline', 'about'].includes(s.kind)).sort((a, b) => (gains[b.id] ?? -99) - (gains[a.id] ?? -99))
  const advice = pending.filter((s) => s.kind === 'formatting')

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-3">
        <div className={`flex h-16 w-16 items-center justify-center rounded-full border-4 text-xl font-bold ${score >= 75 ? 'border-emerald-500 text-emerald-700' : score >= 50 ? 'border-amber-400 text-amber-700' : 'border-rose-400 text-rose-700'}`}>{score}</div>
        <div>
          <div className="font-semibold text-slate-800">Match score (ats-v1, live)</div>
          <div className="text-slate-500">base {baseScore ?? '–'} → draft {score} <span className={delta > 0 ? 'text-emerald-700' : delta < 0 ? 'text-rose-600' : 'text-slate-400'}>({delta > 0 ? '+' : ''}{delta})</span></div>
          <div className="text-[10px] text-slate-400">recomputed as you type · same scorer as the worker</div>
        </div>
      </div>
      {live && (
        <div className="space-y-1">
          {Object.entries(live.components).map(([k, c]) => (
            <div key={k} className="flex items-center gap-2"><span className="w-28 text-slate-600">{COMPONENT_LABEL[k] ?? k}</span><div className="h-1.5 flex-1 rounded bg-slate-100"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${c.max ? Math.round((c.points / c.max) * 100) : 0}%` }} /></div><span className="w-10 text-right tabular-nums text-slate-600">{c.points}/{c.max}</span></div>
          ))}
          <div className="flex flex-wrap gap-1 pt-1">
            {live.matched.slice(0, 12).map((m) => <span key={m.skill} className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700" title={`found in ${m.where}`}>{m.skill}</span>)}
            {live.missing.slice(0, 10).map((m) => <span key={m.skill} className={`rounded border px-1.5 py-0.5 text-[11px] ${m.required ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`} title={m.required ? 'required by the posting' : 'nice to have'}>− {m.skill}</span>)}
          </div>
        </div>
      )}
      {grounding.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
          ⚠ {grounding.length} edited field{grounding.length === 1 ? '' : 's'} mention{grounding.length === 1 ? 's' : ''} things not in your master resume: {[...new Set(grounding.flatMap((g) => g.result.unsupported.map((u) => u.value)))].slice(0, 6).join(', ')}. Your words, your call — but an interviewer may ask.
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-100 pt-2">
        <span className="font-semibold text-slate-800">Suggestions</span>
        <button disabled={busy} onClick={onGenerate} className="btn btn-secondary btn-xs">{suggestions.length ? 'Regenerate' : 'Generate'}</button>
      </div>
      {!suggestions.length && <p className="text-slate-400">None yet — generate grounded suggestions from the gaps above.</p>}
      {actionable.map((s) => (
        <div key={s.id} className="rounded-md border border-slate-200 p-2">
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-100 px-1 text-[10px]">{KIND_LABEL[s.kind] ?? s.kind}</span>
            {s.targetPath && <span className="font-mono text-[10px] text-slate-400">{s.targetPath}</span>}
            <span className={`ml-auto text-[11px] font-semibold ${(gains[s.id] ?? 0) > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{gains[s.id] === null || gains[s.id] === undefined ? '' : `${(gains[s.id] ?? 0) >= 0 ? '+' : ''}${gains[s.id]} on your draft`}</span>
          </div>
          {s.before && <div className="mt-1 text-[11px] text-slate-400 line-through">{s.before}</div>}
          <div className="mt-0.5 text-[11px] text-slate-800">{s.userEdit ?? s.after}</div>
          <div className="mt-0.5 text-[10px] text-slate-500">{s.rationale}{s.jdEvidence ? ` · JD: “${s.jdEvidence}”` : ''}</div>
          {s.flagged && <div className="mt-0.5 text-[10px] text-amber-700">⚠ needs your confirmation: {s.grounding?.unsupported.map((u) => u.value).join(', ')}</div>}
          <div className="mt-1 flex gap-2">
            <button disabled={busy} onClick={() => onApply(s)} className="btn btn-primary btn-xs">Apply</button>
            <button disabled={busy} onClick={() => onReject(s)} className="text-[11px] text-slate-500 hover:underline">Reject</button>
          </div>
        </div>
      ))}
      {questions.map((s) => (
        <div key={s.id} className="rounded-md border border-sky-200 bg-sky-50 p-2">
          <div className="text-[11px] text-sky-900">{s.question ?? `The posting requires ${s.skill}. Have you used it?`}</div>
          <input value={ctx[s.id] ?? ''} onChange={(e) => setCtx((c) => ({ ...c, [s.id]: e.target.value }))} placeholder="one line of context (where / what)" className="mt-1 w-full rounded border border-sky-200 bg-white px-1.5 py-0.5 text-[11px]" />
          <div className="mt-1 flex gap-2">
            <button disabled={busy} onClick={() => onConfirm(s, true, ctx[s.id])} className="btn btn-primary btn-xs">Yes</button>
            <button disabled={busy} onClick={() => onConfirm(s, false)} className="text-[11px] text-slate-500 hover:underline">No</button>
          </div>
        </div>
      ))}
      {advice.map((s) => <div key={s.id} className="rounded-md border border-slate-100 bg-slate-50 p-2 text-[11px] text-slate-600">ℹ {s.rationale}</div>)}
      {appliedList.length > 0 && (
        <div className="border-t border-slate-100 pt-2">
          <div className="mb-1 text-[11px] font-semibold text-slate-700">Applied in this draft ({appliedList.length})</div>
          {appliedList.map((s) => (
            <div key={s.id} className="flex items-center gap-2 py-0.5 text-[11px]"><span className="text-emerald-700">✓</span><span className="flex-1 truncate text-slate-600">{KIND_LABEL[s.kind] ?? s.kind}: {(s.userEdit ?? s.after ?? '').slice(0, 60)}</span>{undoable(s.id) && <button onClick={() => onUndo(s)} className="text-slate-500 hover:underline">undo</button>}</div>
          ))}
        </div>
      )}
    </div>
  )
}
