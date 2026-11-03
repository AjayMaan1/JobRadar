'use client'

import type { Job } from '../../../lib/api-client'
import { CLASS_LABEL } from '../../../lib/api-client'
import { formatRelativeDate, formatSalaryINR } from '../../../lib/formatters'
import { Badge } from '../ui'

const CLASS_SHORT: Record<string, string> = { p1_global_remote: 'P1 Global', p2_india_remote: 'P2 India', p3_ncr_hybrid: 'P3 NCR', none: 'Other' }
const TIER_TONE: Record<string, string> = { tier1: 'success', tier2: 'info', tier3: 'warning', tier4: 'violet', tier5: 'accent', none: 'neutral', p1_global_remote: 'success', p2_india_remote: 'info', p3_ncr_hybrid: 'warning' }

function scoreTone(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'text-slate-300'
  return n >= 70 ? 'text-emerald-600' : n >= 40 ? 'text-amber-600' : 'text-slate-500'
}

/** Workflow progress: analysed · suggestions · tailored · applied. */
function Progress({ job }: { job: Job }) {
  const p = job.progress
  if (!p || (!p.analysed && !p.applied)) return null
  const steps = [
    { on: p.analysed, label: p.analysed ? `Analysed · match ${p.reportScore}` : 'Not analysed' },
    { on: p.analysed && p.pendingSuggestions === 0, label: p.pendingSuggestions ? `${p.pendingSuggestions} suggestions to review` : 'Suggestions reviewed' },
    { on: p.tailored, label: p.tailored ? 'Tailored resume ready' : 'Not tailored' },
    { on: p.applied, label: p.applied ? 'Applied' : 'Not applied' },
  ]
  return (
    <span className="ml-auto flex items-center gap-1" title={steps.map((s) => s.label).join(' → ')}>
      {steps.map((s, i) => <span key={i} className={`inline-block h-1.5 w-1.5 rounded-full ${s.on ? (i === 3 ? 'bg-emerald-500' : 'bg-indigo-500') : 'bg-slate-200'}`} />)}
      {p.pendingSuggestions > 0 && <span className="ml-1 rounded-full bg-indigo-600 px-1.5 text-[10px] leading-4 text-white">{p.pendingSuggestions}</span>}
    </span>
  )
}

export function JobRow({ job, selected, onSelect, isNew }: { job: Job; selected: boolean; onSelect: () => void; isNew?: boolean }) {
  const why = job.matchWhy
  const pay = formatSalaryINR(job)
  const tier = job.eval ? job.eval.tier : job.opportunityClass
  const tierLabel = job.eval ? job.eval.tierLabel : CLASS_SHORT[job.opportunityClass] ?? CLASS_LABEL[job.opportunityClass]
  return (
    <div role="option" data-smoke="job-row" aria-selected={selected} onClick={onSelect} className={`cursor-pointer px-4 py-3 transition ${selected ? 'row-selected' : 'hover:bg-slate-50'} ${job.closedAt ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{job.title}</span>
            {isNew && <Badge tone="info">new</Badge>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span className="truncate font-medium text-slate-600">{job.company}</span>
            <Badge tone={TIER_TONE[tier] ?? 'neutral'}>{tierLabel}</Badge>
            {job.remoteType === 'hybrid' && <span className="text-amber-600">hybrid</span>}
            {job.employmentType === 'contract' && <span className="text-violet-600">contract</span>}
            {pay && <span className="text-slate-700">{pay}</span>}
            {job.closedAt && <span className="text-rose-500">closed</span>}
            {job.userState === 'saved' && <span className="text-amber-600">★ saved</span>}
          </div>
          {why && (why.matched.length || why.missing.length) ? (
            <div className="mt-1 truncate text-[11px]">
              {job.searchHit && <span className="mr-1 rounded bg-violet-50 px-1 text-[10px] text-violet-700" title="Matched your search by meaning">≈ meaning</span>}
              {why.matched.length > 0 && <span className="text-emerald-700">{why.matched.slice(0, 4).join(', ')}</span>}
              {why.missing.length > 0 && <span className="text-slate-400">{why.matched.length ? ' · ' : ''}missing {why.missing.slice(0, 3).join(', ')}</span>}
            </div>
          ) : null}
        </div>
        <div className="grid shrink-0 grid-cols-3 gap-2 text-right tabular-nums">
          <div title="★ Fit: semantic similarity between your profile and this posting"><div className={`text-sm font-semibold ${scoreTone(job.fitScore)}`}>{job.fitScore ?? '–'}</div><div className="text-[10px] text-slate-400">fit</div></div>
          <div title="⌨ ATS: exact-keyword overlap — what an employer's keyword filter sees"><div className={`text-sm font-semibold ${scoreTone(job.matchScore)}`}>{job.matchScore ?? '–'}</div><div className="text-[10px] text-slate-400">ATS</div></div>
          <div title={job.eval ? 'Your score from your preferences (tier + pay + role fit + freshness)' : 'Ranking score'}><div className="text-sm font-semibold text-slate-700">{job.rankingScore}</div><div className="text-[10px] text-slate-400">score</div></div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center text-[11px] text-slate-400">
        <span>{formatRelativeDate(job.firstSeenAt)} · {job.sourceName}</span>
        <Progress job={job} />
      </div>
    </div>
  )
}
