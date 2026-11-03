'use client'

import { useState } from 'react'
import { apiClient } from '../../../lib/api-client'
import type { Suggestion } from '../../../lib/api-client'

const KIND_LABEL: Record<string, string> = {
  bullet_rewrite: 'Rewrite bullet',
  reorder: 'Reorder bullets',
  skills_section: 'Add to skills list',
  formatting: 'Formatting',
  keyword_confirm: 'Confirm experience',
}

function Gain({ n }: { n: number | null }) {
  if (n === null) return null
  const cls = n > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : n < 0 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-500 border-slate-200'
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] tabular-nums ${cls}`}>{n > 0 ? `+${n}` : n}</span>
}

/** One keyword_confirm question card: "Have you used X?" → yes (with context) / no. */
function ConfirmCard({ s, onChanged }: { s: Suggestion; onChanged: (r: { created: Suggestion[]; taskId: string | null }) => void }) {
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  async function answer(yes: boolean) {
    setBusy(true)
    try {
      const r = await apiClient.confirmFact(s.id, yes, yes ? context : undefined)
      onChanged(r)
    } finally {
      setBusy(false)
    }
  }
  if (s.status === 'answered') {
    return (
      <div className="rounded-md border border-slate-100 bg-slate-50 p-2.5 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{s.skill}</span>: {s.answer?.yes ? `confirmed${s.answer.context ? ` — "${s.answer.context}"` : ''}` : 'not claimed (left out, honestly)'}
      </div>
    )
  }
  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/50 p-3 space-y-2">
      <p className="text-sm text-slate-800"><span className="font-semibold">{s.skill}</span> — {s.rationale}</p>
      {s.jdEvidence && <p className="text-[11px] text-slate-500">Posting: “{s.jdEvidence}”</p>}
      {!open ? (
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => setOpen(true)} className="btn btn-primary btn-xs">Yes, I have</button>
          <button disabled={busy} onClick={() => answer(false)} className="btn btn-secondary btn-xs">No</button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={2} placeholder={`Where and how did you use ${s.skill}? One or two sentences in your own words — this becomes a confirmed fact we can draft from.`} className="input input-sm" />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => answer(true)} className="btn btn-primary btn-xs">{busy ? 'Saving…' : 'Confirm'}</button>
            <button disabled={busy} onClick={() => setOpen(false)} className="text-xs text-slate-500">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ChangeCard({ s, onChanged }: { s: Suggestion; onChanged: (s: Suggestion) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(s.userEdit ?? s.after ?? '')
  const [busy, setBusy] = useState(false)
  const decided = s.status === 'accepted' || s.status === 'edited' || s.status === 'rejected'
  async function set(status: 'accepted' | 'rejected' | 'edited' | 'pending', userEdit?: string) {
    setBusy(true)
    try { onChanged(await apiClient.patchSuggestion(s.id, { status, userEdit })) } finally { setBusy(false); setEditing(false) }
  }
  const border = s.status === 'accepted' || s.status === 'edited' ? 'border-emerald-200' : s.status === 'rejected' ? 'border-slate-100 opacity-60' : s.flagged ? 'border-amber-300' : 'border-slate-200'
  const isReorder = s.kind === 'reorder'
  return (
    <div className={`rounded-md border bg-white p-3 space-y-2 ${border}`}>
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">{KIND_LABEL[s.kind] ?? s.kind}</span>
        <Gain n={s.expectedGain} />
        {s.flagged && <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800" title={s.grounding?.unsupported.map((u) => u.value).join(', ')}>needs your confirmation</span>}
        {s.targetPath && <span className="ml-auto font-mono text-[10px] text-slate-400">{s.targetPath.replace(/^\/work\/(\d+)\/highlights\/(\d+)$/, 'role $1 · bullet $2').replace(/^\/work\/(\d+)\/highlights$/, 'role $1 · order')}</span>}
      </div>
      {s.kind !== 'formatting' && (
        <div className="grid grid-cols-1 gap-1.5 text-xs">
          {s.before && !isReorder && <div className="rounded bg-rose-50/60 px-2 py-1 text-slate-600 line-through decoration-rose-300">{s.before}</div>}
          {editing ? (
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="input input-sm" />
          ) : (
            <div className="rounded bg-emerald-50/60 px-2 py-1 text-slate-800">{isReorder ? <ol className="list-decimal pl-4">{(JSON.parse(s.userEdit ?? s.after ?? '[]') as string[]).map((b, i) => <li key={i}>{b}</li>)}</ol> : s.userEdit ?? s.after}</div>
          )}
        </div>
      )}
      <p className="text-[11px] text-slate-500">{s.rationale}{s.jdEvidence ? <> · <span className="text-slate-400">Posting: “{s.jdEvidence}”</span></> : null}</p>
      {s.flagged && s.grounding && !s.grounding.ok && (
        <p className="text-[11px] text-amber-800">Not found in your resume: {s.grounding.unsupported.map((u) => u.value).join(', ')}. Accept only if it is true — or edit it.</p>
      )}
      {s.kind !== 'formatting' && (
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button disabled={busy} onClick={() => set('edited', text)} className="btn btn-primary btn-xs">Save edit</button>
              <button disabled={busy} onClick={() => setEditing(false)} className="text-xs text-slate-500">Cancel</button>
            </>
          ) : (
            <>
              <button disabled={busy || s.status === 'accepted'} onClick={() => set('accepted')} className="btn btn-success btn-xs">{s.status === 'accepted' ? 'Accepted' : 'Accept'}</button>
              {!isReorder && <button disabled={busy} onClick={() => setEditing(true)} className="btn btn-secondary btn-xs">Edit</button>}
              <button disabled={busy || s.status === 'rejected'} onClick={() => set('rejected')} className="btn btn-secondary btn-xs">{s.status === 'rejected' ? 'Rejected' : 'Reject'}</button>
              {decided && <button disabled={busy} onClick={() => set('pending')} className="ml-auto text-[11px] text-slate-400 hover:underline">undo</button>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function SuggestionList({ suggestions, onChanged, onConfirmed }: { suggestions: Suggestion[]; onChanged: (s: Suggestion) => void; onConfirmed: (r: { created: Suggestion[]; taskId: string | null }) => void }) {
  const confirms = suggestions.filter((s) => s.kind === 'keyword_confirm')
  const changes = suggestions.filter((s) => !['keyword_confirm', 'headline', 'about', 'answer'].includes(s.kind))
  const accepted = changes.filter((s) => s.status === 'accepted' || s.status === 'edited')
  const totalGain = accepted.reduce((a, s) => a + (s.expectedGain ?? 0), 0)
  return (
    <div className="space-y-4">
      {confirms.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-700">Questions about missing requirements <span className="text-slate-400">— we never add a skill you haven&apos;t confirmed</span></p>
          <div className="space-y-2">{confirms.map((s) => <ConfirmCard key={s.id} s={s} onChanged={onConfirmed} />)}</div>
        </div>
      )}
      {changes.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-700">Suggested changes <span className="text-slate-400">({accepted.length} accepted{totalGain ? `, ≈ +${totalGain} pts` : ''})</span></p>
          <div className="space-y-2">{changes.map((s) => <ChangeCard key={s.id} s={s} onChanged={onChanged} />)}</div>
        </div>
      )}
      {!confirms.length && !changes.length && <p className="text-xs text-slate-400">No suggestions yet.</p>}
    </div>
  )
}
