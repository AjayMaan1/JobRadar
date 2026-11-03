'use client'

import { apiClient } from '../../../lib/api-client'
import type { ResumeRow } from '../../../lib/api-client'
import { Badge } from '../ui'

const STATUS: Record<ResumeRow['parseStatus'], { label: string; tone: string }> = {
  pending: { label: 'Queued', tone: 'neutral' },
  parsing: { label: 'Parsing…', tone: 'info' },
  parsed: { label: 'Parsed', tone: 'success' },
  needs_review: { label: 'Needs review', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
}

export function ResumeList({ resumes, selectedId, onSelect, onChanged }: { resumes: ResumeRow[]; selectedId: string | null; onSelect: (id: string) => void; onChanged: () => Promise<void> }) {
  if (!resumes.length) return null
  return (
    <div className="-mx-5 -mb-5 divide-y divide-slate-100 border-t border-slate-100">
      {resumes.map((r) => {
        const st = STATUS[r.parseStatus]
        const errors = r.parseWarnings.filter((w) => w.severity === 'error').length
        const warns = r.parseWarnings.filter((w) => w.severity === 'warn').length
        return (
          <div key={r.id} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(r.id) }} className={`cursor-pointer px-5 py-3 transition ${selectedId === r.id ? 'row-selected' : 'hover:bg-slate-50'}`} onClick={() => onSelect(r.id)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-900"><span className="truncate">{r.label}</span>{r.isMaster && <Badge tone="accent">Master</Badge>}</p>
                <p className="text-xs text-slate-400 truncate">{r.sourceFilename}</p>
              </div>
              <Badge tone={st.tone} className="shrink-0">{st.label}</Badge>
            </div>
            {(errors || warns) ? <p className="mt-1 text-xs text-slate-500">{errors ? `${errors} parse problem(s)` : ''}{errors && warns ? ' · ' : ''}{warns ? `${warns} warning(s)` : ''}</p> : null}
            {r.parseError && <p className="mt-1 text-xs text-rose-600">{r.parseError}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {r.parseStatus !== 'failed' && r.parseStatus !== 'pending' && r.parseStatus !== 'parsing' && <a href={`/resumes/${r.id}/edit`} onClick={(e) => e.stopPropagation()} className="btn btn-secondary btn-xs" title="Visual editor with live preview">Edit</a>}
              {!r.isMaster && r.parseStatus !== 'failed' && <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); apiClient.patchResume(r.id, { isMaster: true }).then(onChanged) }}>Make master</button>}
              <a className="btn btn-ghost btn-xs" href={`/api/resumes/${r.id}/file`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Original</a>
              <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); apiClient.patchResume(r.id, { reparse: true }).then(onChanged) }}>Re-parse</button>
              <button className="btn btn-ghost btn-xs ml-auto text-rose-600 hover:bg-rose-50" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this resume and all its versions?')) apiClient.deleteResume(r.id).then(onChanged) }}>Delete</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
