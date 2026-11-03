'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '../../../lib/api-client'
import { Card, CardHeader } from '../ui'
import type { CandidateProfile } from '../../../lib/api-client'

export function ProfileEditor({ profile, onSaved }: { profile: CandidateProfile | null; onSaved: () => Promise<void> }) {
  const [headline, setHeadline] = useState('')
  const [about, setAbout] = useState('')
  const [titles, setTitles] = useState('')
  const [skills, setSkills] = useState('')
  const [years, setYears] = useState('')
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setHeadline(profile?.headline ?? '')
    setAbout(profile?.about ?? '')
    setTitles((profile?.targetTitles ?? []).join(', '))
    setSkills((profile?.skills ?? []).map((s) => s.name).join(', '))
    setYears(profile?.yearsExperience != null ? String(profile.yearsExperience) : '')
    setDefaults(Object.fromEntries(Object.entries(profile?.applyDefaults ?? {}).map(([k, v]) => [k, v ?? ''])))
  }, [profile])

  async function save() {
    setSaving(true); setMsg(null)
    try {
      await apiClient.patchProfile({
        headline, about,
        targetTitles: titles.split(',').map((t) => t.trim()).filter(Boolean),
        skills: skills.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name })),
        yearsExperience: years === '' ? null : Number(years),
        applyDefaults: defaults,
      })
      setMsg('Saved ✓')
      await onSaved()
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="space-y-4">
      <CardHeader title="Master profile" description="Seeded from your master resume · never changed by tailoring" icon="user" />
      <label className="label">Headline
        <input value={headline} onChange={(e) => setHeadline(e.target.value)} className="input mt-1" placeholder="Senior Backend Engineer · Go / Kubernetes" />
      </label>
      <label className="label">About me
        <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={4} className="input mt-1" />
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="label">Target titles (comma-separated)
          <input value={titles} onChange={(e) => setTitles(e.target.value)} className="input mt-1" />
        </label>
        <label className="label">Years of experience
          <input value={years} onChange={(e) => setYears(e.target.value)} type="number" step="0.5" min="0" className="input mt-1" />
        </label>
      </div>
      <label className="label">Skills (comma-separated; these drive job ranking and the feed match badge)
        <textarea value={skills} onChange={(e) => setSkills(e.target.value)} rows={3} className="input mt-1" />
      </label>
      <details className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">Application defaults (used to pre-fill standard ATS questions)</summary>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
          {([['noticePeriod', 'Notice period / availability'], ['currentLocation', 'Current location'], ['workAuthorization', 'Work authorisation'], ['salaryExpectation', 'Salary expectation'], ['linkedin', 'LinkedIn URL'], ['portfolio', 'Portfolio / GitHub URL']] as const).map(([k, label]) => (
            <label key={k} className="label">{label}
              <input value={defaults[k] ?? ''} onChange={(e) => setDefaults((d) => ({ ...d, [k]: e.target.value }))} className="input mt-1" />
            </label>
          ))}
        </div>
      </details>
      {profile?.confirmedFacts && profile.confirmedFacts.length > 0 && (
        <details className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-700">Confirmed facts ({profile.confirmedFacts.length}) — what tailoring is allowed to draw on beyond your resume</summary>
          <ul className="mt-1 list-disc pl-4 text-xs text-slate-600">{profile.confirmedFacts.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </details>
      )}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn btn-primary btn-sm">{saving ? 'Saving…' : 'Save profile'}</button>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
        <a href="/account" className="ml-auto text-xs text-slate-400 hover:text-slate-600">Export or erase your data → Account</a>
      </div>
    </Card>
  )
}

