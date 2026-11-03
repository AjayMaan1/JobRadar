'use client'

import { useState } from 'react'
import { apiClient } from '../../../lib/api-client'
import type { Suggestion } from '../../../lib/api-client'

type Tone = 'conservative' | 'balanced' | 'assertive'

interface Props {
  reportId: string
  kind: 'headline' | 'about'
  masterText: string | null
  variants: Suggestion[]
  /** The user's current choice for this application (null = keep master). */
  chosen: string | null
  onChoose: (text: string | null) => void
  onVariants: () => Promise<void>
}

/**
 * Opt-in per application (HLD V1 / backlog C8). Off by default; nothing is generated until the toggle is on and
 * "Generate variants" is clicked. The master text on the profile is never changed from here.
 */
export function HeadlineAbout({ reportId, kind, masterText, variants, chosen, onChoose, onVariants }: Props) {
  const [enabled, setEnabled] = useState(chosen !== null)
  const [tone, setTone] = useState<Tone>('balanced')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const label = kind === 'headline' ? 'headline' : 'About / summary'

  async function generate() {
    setBusy(true); setError(null); setProgress('Queued…')
    try {
      const { taskId } = await apiClient.generateVariants(reportId, kind, tone)
      const t = await apiClient.waitTask(taskId, (s) => setProgress(s.progress ?? 'Drafting…'))
      if (t.status === 'failed') setError(t.error ?? 'Failed')
      await onVariants()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false); setProgress(null)
    }
  }

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <label className="flex items-center gap-2 text-sm text-slate-800">
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); if (!e.target.checked) onChoose(null) }} />
        Tailor {label} for this role <span className="text-[11px] text-slate-400">(off by default · your master {label} is never changed)</span>
      </label>
      {enabled && (
        <div className="mt-3 space-y-3">
          <div className="rounded bg-slate-50 p-2 text-xs text-slate-600">
            <span className="font-medium text-slate-700">Master:</span> {masterText || <em className="text-slate-400">none set</em>}
          </div>
          <div className="flex items-center gap-2">
            <select value={tone} onChange={(e) => setTone(e.target.value as Tone)} className="input input-sm">
              <option value="conservative">Conservative</option>
              <option value="balanced">Balanced</option>
              <option value="assertive">Assertive</option>
            </select>
            <button disabled={busy} onClick={generate} className="btn btn-primary btn-xs">{busy ? progress ?? 'Working…' : variants.length ? 'Regenerate variants' : 'Generate variants'}</button>
            {error && <span className="text-xs text-rose-600">{error}</span>}
          </div>
          {variants.length > 0 && (
            <div className="grid grid-cols-1 gap-2">
              {variants.map((v) => {
                const text = v.userEdit ?? v.after ?? ''
                const selected = chosen === text
                return (
                  <div key={v.id} className={`rounded-md border p-2 text-xs ${selected ? 'border-emerald-400 bg-emerald-50/50' : v.flagged ? 'border-amber-300' : 'border-slate-200'}`}>
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="capitalize">{v.variant}</span>
                      {v.expectedGain !== null && <span className="rounded border border-slate-200 px-1">{v.expectedGain! >= 0 ? '+' : ''}{v.expectedGain} pts</span>}
                      {v.flagged && <span className="rounded border border-amber-300 bg-amber-50 px-1 text-amber-800" title={v.grounding?.unsupported.map((u) => u.value).join(', ')}>contains unsupported claims</span>}
                    </div>
                    {editing === v.id ? (
                      <EditBox initial={text} onSave={async (t) => { await apiClient.patchSuggestion(v.id, { status: 'edited', userEdit: t }); setEditing(null); onChoose(t); await onVariants() }} onCancel={() => setEditing(null)} />
                    ) : (
                      <>
                        <p className="text-slate-800 whitespace-pre-wrap">{text}</p>
                        <div className="mt-1.5 flex gap-2">
                          <button onClick={() => onChoose(selected ? null : text)} className={`rounded-md px-2 py-0.5 text-[11px] ${selected ? 'bg-emerald-600 text-white' : 'border border-slate-200 text-slate-700'}`}>{selected ? 'Selected' : 'Use this'}</button>
                          <button onClick={() => setEditing(v.id)} className="text-[11px] text-slate-500 hover:underline">Edit</button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => Promise<void>; onCancel: () => void }) {
  const [t, setT] = useState(initial)
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-1">
      <textarea value={t} onChange={(e) => setT(e.target.value)} rows={3} className="input input-sm" />
      <div className="flex gap-2">
        <button disabled={busy} onClick={async () => { setBusy(true); try { await onSave(t) } finally { setBusy(false) } }} className="btn btn-primary btn-xs">Save &amp; use</button>
        <button onClick={onCancel} className="text-[11px] text-slate-500">Cancel</button>
      </div>
    </div>
  )
}
