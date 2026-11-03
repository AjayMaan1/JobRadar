'use client'

import type { AtsReport } from '../../../lib/api-client'

const COMPONENT_LABEL: Record<string, string> = {
  requiredSkills: 'Required skills',
  preferredSkills: 'Nice-to-have skills',
  title: 'Title & seniority',
  experience: 'Experience',
  parseability: 'Parseability',
  quality: 'Bullet quality',
  keywords: 'Domain keywords',
}


export function ReportView({ report, showAll, onToggleAll }: { report: AtsReport; showAll: boolean; onToggleAll: () => void }) {
  const b = report.breakdown
  const color = b.score >= 75 ? 'text-emerald-600' : b.score >= 50 ? 'text-amber-600' : 'text-rose-600'
  const missingRequired = b.missing.filter((m) => m.required)
  const missingPreferred = b.missing.filter((m) => !m.required)
  const components = Object.entries(b.components) as Array<[string, { points: number; max: number; note: string }]>
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-5">
        <div className="shrink-0 text-center">
          <div className={`text-4xl font-bold ${color}`}>{b.score}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">of 100</div>
        </div>
        <div className="flex-1 space-y-1.5">
          {components.map(([key, c]) => (
            <div key={key} className="flex items-center gap-2 text-xs" title={c.note}>
              <span className="w-32 shrink-0 text-slate-500">{COMPONENT_LABEL[key] ?? key}</span>
              <div className="h-2 flex-1 rounded bg-slate-100">
                <div className={`h-2 rounded ${c.points / c.max >= 0.7 ? 'bg-emerald-400' : c.points / c.max >= 0.4 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${Math.round((c.points / c.max) * 100)}%` }} />
              </div>
              <span className="w-12 text-right tabular-nums text-slate-700">{c.points}/{c.max}</span>
            </div>
          ))}
        </div>
      </div>

      {missingRequired.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-700">Missing required skills <span className="text-slate-400">({missingRequired.length})</span></p>
          <div className="flex flex-wrap gap-1.5">
            {missingRequired.map((m) => (
              <span key={m.skill} title={m.jdEvidence ?? ''} className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs text-rose-700">{m.skill}{m.group ? ' (or alternative)' : ''}</span>
            ))}
          </div>
        </div>
      )}
      {missingPreferred.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-700">Missing nice-to-have</p>
          <div className="flex flex-wrap gap-1.5">
            {missingPreferred.map((m) => <span key={m.skill} className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{m.skill}</span>)}
          </div>
        </div>
      )}
      <div>
        <p className="mb-1 text-xs font-medium text-slate-700">Matched <span className="text-slate-400">({b.matched.length})</span></p>
        <div className="flex flex-wrap gap-1.5">
          {(showAll ? b.matched : b.matched.slice(0, 12)).map((m) => (
            <span key={m.skill} title={m.snippet ?? `found in ${m.where}`} className={`rounded border px-2 py-0.5 text-xs ${m.where === 'experience' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
              {m.skill}{m.where !== 'experience' ? ` · ${m.where}` : ''}
            </span>
          ))}
          {b.matched.length > 12 && <button onClick={onToggleAll} className="text-xs link">{showAll ? 'show less' : `+${b.matched.length - 12} more`}</button>}
        </div>
      </div>

      <ul className="space-y-1 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
        {components.filter(([, c]) => c.points < c.max).map(([key, c]) => (
          <li key={key}><span className="font-medium text-slate-700">{COMPONENT_LABEL[key] ?? key}:</span> {c.note}</li>
        ))}
        {b.keywordsMissing.length > 0 && <li><span className="font-medium text-slate-700">Domain keywords missing:</span> {b.keywordsMissing.join(', ')}</li>}
      </ul>
      <p className="text-[11px] text-slate-400">Nothing in your resume is changed by this analysis. Every change below needs your explicit accept.</p>
    </div>
  )
}
