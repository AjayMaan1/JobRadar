'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from '../layout/AppShell'
import { apiClient } from '../../../lib/api-client'
import type { PreferencesDoc, PreferencePreset, PreferencesPreview, SavedPreferences } from '../../../lib/api-client'
import { COUNTRY_OPTIONS, METRO_OPTIONS, CURRENCY_OPTIONS, TIMEZONE_OPTIONS, CATEGORY_OPTIONS, SENIORITY_OPTIONS, EMPLOYMENT_OPTIONS } from './options'

/**
 * Dynamic preferences (docs/HLD-dynamic-preferences.md): edit the document, see the effect on a sample of
 * open jobs before saving, apply/save presets, revert history. First visit (seeded doc, nothing evaluated)
 * renders as a short wizard.
 */
export function PreferencesPage() {
  const [saved, setSaved] = useState<SavedPreferences | null>(null)
  const [doc, setDoc] = useState<PreferencesDoc | null>(null)
  const [presets, setPresets] = useState<PreferencePreset[]>([])
  const [preview, setPreview] = useState<PreferencesPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [history, setHistory] = useState<Array<{ id: string; version: number; source: string; note: string | null; changedAt: string }>>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wizard, setWizard] = useState(false)
  const [step, setStep] = useState(0)
  const [presetName, setPresetName] = useState('')

  const load = useCallback(async () => {
    const [s, p, h] = await Promise.all([apiClient.getPreferences(), apiClient.getPresets(), apiClient.getPreferencesHistory()])
    setSaved(s); setDoc(structuredClone(s.doc)); setPresets(p.data); setHistory(h.data)
    if (s.source === 'seed' && (s.evaluated ?? 0) === 0) setWizard(true)
  }, [])
  useEffect(() => { load().catch((e) => setError((e as Error).message)) }, [load])

  // debounced live preview
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!doc) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setPreviewing(true)
      apiClient.previewPreferences(doc).then(setPreview).catch(() => setPreview(null)).finally(() => setPreviewing(false))
    }, 600)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [doc])

  const dirty = useMemo(() => saved && doc && JSON.stringify(saved.doc) !== JSON.stringify(doc), [saved, doc])
  const patch = (fn: (d: PreferencesDoc) => void) => setDoc((d) => { if (!d) return d; const n = structuredClone(d); fn(n); return n })

  async function save(note?: string) {
    if (!doc) return
    setBusy('Saving…'); setError(null)
    try {
      const s = await apiClient.savePreferences(doc, note)
      setSaved(s); setDoc(structuredClone(s.doc)); setWizard(false)
      if (s.taskId) await apiClient.waitTask(s.taskId, (t) => setBusy(t.progress ?? 'Re-evaluating your jobs…')).catch(() => undefined)
      await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  async function applyPreset(id: string, replaceHome: boolean) {
    setBusy('Applying preset…'); setError(null)
    try {
      const s = await apiClient.applyPreset(id, replaceHome)
      setSaved(s); setDoc(structuredClone(s.doc))
      if (s.taskId) await apiClient.waitTask(s.taskId, (t) => setBusy(t.progress ?? 'Re-evaluating…')).catch(() => undefined)
      await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  if (!doc || !saved) return <AppShell title="Preferences"><p className="text-sm text-slate-400">{error ?? 'Loading preferences…'}</p></AppShell>

  const tierLabel = (id: string) => doc.tiers.find((t) => t.id === id)?.label ?? (id === 'none' ? 'Not in your feed' : id)

  const WIZARD_STEPS = ['Where you are', 'How you want to work', 'Pay', 'Start from a preset', 'Review']

  return (
    <AppShell title="Preferences" subtitle="What counts as a match for you" actions={
      <div className="flex items-center gap-2">
        {busy && <span className="text-xs text-slate-500">{busy}</span>}
        {dirty && !busy && <span className="text-xs text-amber-700">unsaved changes</span>}
        <button disabled={!dirty || Boolean(busy)} onClick={() => save()} className="btn btn-primary btn-sm">Save &amp; re-evaluate</button>
      </div>
    }>
      {error && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{error}</div>}
      {saved.warnings.length > 0 && <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{saved.warnings.map((w) => <div key={w}>⚠ {w}</div>)}</div>}

      {wizard && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-sky-900">Welcome — let&apos;s set up your radar ({step + 1}/{WIZARD_STEPS.length}: {WIZARD_STEPS[step]})</p>
            <button onClick={() => setWizard(false)} className="text-xs text-sky-700 hover:underline">Skip, I&apos;ll use the form</button>
          </div>
          <p className="text-xs text-sky-800">
            {step === 0 && 'Your home country, timezone and currency decide eligibility and how salaries are shown. Add the metros you could commute to for hybrid roles.'}
            {step === 1 && 'Pick the work modes you accept. Remote roles are checked for "can I apply from my country"; hybrid/onsite roles must be in one of your metros.'}
            {step === 2 && 'A pay floor hides postings that publish a salary below it (postings without a salary are never hidden). Bands add points above the floor.'}
            {step === 3 && 'Presets are starting points. Applying one keeps your home and the skills seeded from your resume.'}
            {step === 4 && 'Check the preview on the right: it shows how the last 2,000 open jobs would land in your tiers. Then save.'}
          </p>
          <div className="mt-2 flex gap-2">
            {step > 0 && <button onClick={() => setStep(step - 1)} className="rounded-md border border-sky-300 px-2 py-1 text-xs">Back</button>}
            {step < WIZARD_STEPS.length - 1 ? <button onClick={() => setStep(step + 1)} className="btn btn-primary btn-xs">Next</button> : <button onClick={() => save('wizard')} className="btn btn-primary btn-xs">Save &amp; start</button>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          {/* Home */}
          <Section title="Home" hint="Where you apply from." highlight={wizard && step === 0}>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Field label="Country"><select value={doc.home.country} onChange={(e) => patch((d) => { d.home.country = e.target.value })} className={INPUT}>{COUNTRY_OPTIONS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></Field>
              <Field label="Timezone"><select value={doc.home.timezone} onChange={(e) => patch((d) => { d.home.timezone = e.target.value })} className={INPUT}>{TIMEZONE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
              <Field label="Currency"><select value={doc.home.currency} onChange={(e) => patch((d) => { d.home.currency = e.target.value; d.pay.currency = e.target.value })} className={INPUT}>{CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
              <Field label="Metros (for hybrid/onsite)">
                <MultiSelect value={doc.home.metros} options={METRO_OPTIONS.filter((m) => m.country === doc.home.country || doc.home.metros.includes(m.id)).map((m) => ({ id: m.id, label: `${m.label} (${m.country})` }))} onChange={(v) => patch((d) => { d.home.metros = v })} />
              </Field>
            </div>
          </Section>

          {/* Work */}
          <Section title="Work modes" hint="Remote needs eligibility from your country; hybrid/onsite need one of your metros." highlight={wizard && step === 1}>
            <div className="flex flex-wrap gap-3 text-xs">
              {(['remote', 'hybrid', 'onsite'] as const).map((m) => (
                <label key={m} className="flex items-center gap-1"><input type="checkbox" checked={doc.work.modes.includes(m)} onChange={(e) => patch((d) => { d.work.modes = e.target.checked ? [...new Set([...d.work.modes, m])] : d.work.modes.filter((x) => x !== m) })} />{m}</label>
              ))}
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">Employment:</span>
              {EMPLOYMENT_OPTIONS.map((t) => (
                <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={doc.role.employmentTypes.includes(t)} onChange={(e) => patch((d) => { d.role.employmentTypes = e.target.checked ? [...new Set([...d.role.employmentTypes, t])] : d.role.employmentTypes.filter((x) => x !== t) })} />{t.replace('_', ' ')}</label>
              ))}
            </div>
          </Section>

          {/* Tiers */}
          <Section title="Tiers" hint="Evaluated top to bottom, first match wins. Points feed the score; “instant” tiers can trigger Telegram alerts (your channels may narrow them further).">
            <div className="space-y-2">
              {doc.tiers.map((t, i) => (
                <div key={t.id} className={`rounded-md border p-2 text-xs ${t.enabled ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-100 px-1.5 font-mono text-[10px]">{t.id}</span>
                    <input value={t.label} onChange={(e) => patch((d) => { d.tiers[i].label = e.target.value })} className="input input-sm w-48" />
                    <label className="flex items-center gap-1"><input type="checkbox" checked={t.enabled} onChange={(e) => patch((d) => { d.tiers[i].enabled = e.target.checked })} />enabled</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={t.instant} onChange={(e) => patch((d) => { d.tiers[i].instant = e.target.checked })} />instant alert</label>
                    <label className="flex items-center gap-1">points <input type="number" min={0} max={60} value={t.points} onChange={(e) => patch((d) => { d.tiers[i].points = Number(e.target.value) })} className="input input-sm w-16 text-center" /></label>
                    <span className="ml-auto flex gap-1">
                      <button disabled={i === 0} onClick={() => patch((d) => { const [x] = d.tiers.splice(i, 1); d.tiers.splice(i - 1, 0, x) })} className="text-slate-500 disabled:opacity-30">↑</button>
                      <button disabled={i === doc.tiers.length - 1} onClick={() => patch((d) => { const [x] = d.tiers.splice(i, 1); d.tiers.splice(i + 1, 0, x) })} className="text-slate-500 disabled:opacity-30">↓</button>
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-slate-600">
                    <span>when:</span>
                    <label className="flex items-center gap-1">mode
                      <select value={(t.when.workMode ?? [])[0] ?? ''} onChange={(e) => patch((d) => { d.tiers[i].when.workMode = e.target.value ? [e.target.value] : undefined })} className="input"><option value="">any</option><option value="remote">remote</option><option value="hybrid">hybrid</option><option value="onsite">onsite</option></select>
                    </label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={Boolean(t.when.eligibleForMe)} onChange={(e) => patch((d) => { d.tiers[i].when.eligibleForMe = e.target.checked || undefined })} />eligible from my country</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={t.when.locationCountry === 'home'} onChange={(e) => patch((d) => { d.tiers[i].when.locationCountry = e.target.checked ? 'home' : undefined })} />location names my country</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={t.when.locationMetro === 'home.metros'} onChange={(e) => patch((d) => { d.tiers[i].when.locationMetro = e.target.checked ? 'home.metros' : undefined })} />in my metros</label>
                    <label className="flex items-center gap-1">company tags <input value={(t.when.companyTag ?? []).join(', ')} onChange={(e) => patch((d) => { const v = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); d.tiers[i].when.companyTag = v.length ? v : undefined })} placeholder="mnc, big_tech" className="input w-32" /></label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={Boolean(t.when.paysFloor)} onChange={(e) => patch((d) => { d.tiers[i].when.paysFloor = e.target.checked || undefined })} />publishes pay ≥ floor</label>
                  </div>
                </div>
              ))}
              <div className="flex gap-2 text-xs">
                {doc.tiers.length < 8 && <button onClick={() => patch((d) => { d.tiers.push({ id: `tier${d.tiers.length + 1}`, label: 'New tier', enabled: true, instant: false, points: 10, when: {} }) })} className="link">+ add tier</button>}
                {doc.tiers.length > 1 && <button onClick={() => patch((d) => { d.tiers.pop(); d.feed.defaultTiers = d.feed.defaultTiers.filter((id) => d.tiers.some((t) => t.id === id)) })} className="text-rose-600 hover:underline">remove last</button>}
              </div>
              <div className="text-xs text-slate-600">Inbox shows by default: {doc.tiers.map((t) => (
                <label key={t.id} className="ml-2 inline-flex items-center gap-1"><input type="checkbox" checked={doc.feed.defaultTiers.includes(t.id)} onChange={(e) => patch((d) => { d.feed.defaultTiers = e.target.checked ? [...new Set([...d.feed.defaultTiers, t.id])] : d.feed.defaultTiers.filter((x) => x !== t.id) })} />{t.label}</label>
              ))}</div>
            </div>
          </Section>

          {/* Role */}
          <Section title="Role" hint="Seeded from your resume; used for role-fit points (skills up to 8, title/category 4, seniority 3).">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Field label="Target titles (comma-separated)"><input value={doc.role.targetTitles.join(', ')} onChange={(e) => patch((d) => { d.role.targetTitles = e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) })} className={INPUT} /></Field>
              <Field label="Skills (comma-separated)"><input value={doc.role.skills.join(', ')} onChange={(e) => patch((d) => { d.role.skills = e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100) })} className={INPUT} /></Field>
              <Field label="Categories"><MultiSelect value={doc.role.categories} options={CATEGORY_OPTIONS.map((c) => ({ id: c, label: c }))} onChange={(v) => patch((d) => { d.role.categories = v })} /></Field>
              <Field label="Seniority"><MultiSelect value={doc.role.seniority} options={SENIORITY_OPTIONS.map((c) => ({ id: c, label: c }))} onChange={(v) => patch((d) => { d.role.seniority = v })} /></Field>
            </div>
          </Section>

          {/* Pay */}
          <Section title="Pay" hint={`Annual, in ${doc.pay.currency}. Postings with a published salary below the floor are hidden; bands add points.`} highlight={wizard && step === 2}>
            <div className="flex flex-wrap items-end gap-3 text-xs">
              <Field label={`Floor (${doc.pay.currency}/yr, blank = none)`}><input type="number" min={0} value={doc.pay.floor ?? ''} onChange={(e) => patch((d) => { d.pay.floor = e.target.value ? Number(e.target.value) : null })} className={INPUT} /></Field>
              <label className="flex items-center gap-1"><input type="checkbox" checked={doc.pay.requireTransparency} onChange={(e) => patch((d) => { d.pay.requireTransparency = e.target.checked })} />hide postings without a published salary</label>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {doc.pay.bands.map((b, i) => (
                <span key={i} className="flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5">≥ <input type="number" value={b.min} onChange={(e) => patch((d) => { d.pay.bands[i].min = Number(e.target.value) })} className="input input-sm w-28" /> → <input type="number" min={0} max={40} value={b.pts} onChange={(e) => patch((d) => { d.pay.bands[i].pts = Number(e.target.value) })} className="input input-sm w-14 text-center" /> pts <button onClick={() => patch((d) => { d.pay.bands.splice(i, 1) })} className="text-rose-600">×</button></span>
              ))}
              {doc.pay.bands.length < 8 && <button onClick={() => patch((d) => { d.pay.bands.push({ min: d.pay.floor ?? 0, pts: 10 }) })} className="link">+ band</button>}
            </div>
          </Section>

          {/* Companies */}
          <Section title="Companies" hint="Hard exclusions — never shown, never alerted.">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <Field label="Exclude companies headquartered in"><MultiSelect value={doc.companies.excludeHqCountries} options={COUNTRY_OPTIONS.map((c) => ({ id: c.code, label: c.label }))} onChange={(v) => patch((d) => { d.companies.excludeHqCountries = v })} /></Field>
              <Field label="Exclude companies (names, comma-separated)"><input value={doc.companies.exclude.join(', ')} onChange={(e) => patch((d) => { d.companies.exclude = e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} className={INPUT} /></Field>
              <Field label="Only companies tagged (blank = any)"><input value={doc.companies.onlyTags.join(', ')} onChange={(e) => patch((d) => { d.companies.onlyTags = e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="mnc, big_tech, yc" className={INPUT} /></Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <span className="text-slate-500">Hide from inbox:</span>
              {EMPLOYMENT_OPTIONS.map((t) => <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={doc.feed.hideEmploymentTypes.includes(t)} onChange={(e) => patch((d) => { d.feed.hideEmploymentTypes = e.target.checked ? [...new Set([...d.feed.hideEmploymentTypes, t])] : d.feed.hideEmploymentTypes.filter((x) => x !== t) })} />{t.replace('_', ' ')}</label>)}
              <label className="ml-auto flex items-center gap-1">digest hour <input type="number" min={0} max={23} value={doc.alerts.digestHour} onChange={(e) => patch((d) => { d.alerts.digestHour = Number(e.target.value) })} className="input input-sm w-16 text-center" /> ({doc.home.timezone})</label>
            </div>
          </Section>
        </div>

        <div className="space-y-4">
          {/* Preview */}
          <Section title="Preview" hint="How the most recent open jobs would land in your tiers with the current (unsaved) document." highlight={wizard && step === 4}>
            {preview ? (
              <div className="text-xs">
                <p className="text-slate-500">{preview.sample} recent open jobs{previewing ? ' · updating…' : ''}</p>
                <ul className="mt-1 space-y-1">
                  {[...doc.tiers.map((t) => t.id), 'none'].map((id) => (
                    <li key={id}>
                      <div className="flex items-center gap-2"><span className="w-36 truncate font-medium text-slate-800">{tierLabel(id)}</span><div className="h-2 flex-1 rounded bg-slate-100"><div className={`h-2 rounded ${id === 'none' ? 'bg-slate-300' : 'bg-emerald-500'}`} style={{ width: `${Math.round(((preview.counts[id] ?? 0) / Math.max(1, preview.sample)) * 100)}%` }} /></div><span className="w-10 text-right text-slate-600">{preview.counts[id] ?? 0}</span></div>
                      {(preview.examples[id] ?? []).slice(0, 3).map((e) => <div key={e.id} className="ml-2 truncate text-[11px] text-slate-500" title={e.reasons.join(' · ')}>· {e.title} — {e.company}{e.reasons.length ? ` (${e.reasons.slice(0, 2).join(', ')})` : ''}</div>)}
                    </li>
                  ))}
                </ul>
                {Object.keys(preview.excluded).length > 0 && <p className="mt-2 text-slate-500">Excluded: {Object.entries(preview.excluded).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}
                {preview.warnings.length > 0 && <div className="mt-2 text-amber-700">{preview.warnings.map((w) => <div key={w}>⚠ {w}</div>)}</div>}
              </div>
            ) : <p className="text-xs text-slate-400">{previewing ? 'Computing…' : 'No preview yet.'}</p>}
          </Section>

          {/* Presets */}
          <Section title="Presets" hint="System presets are starting points; applying one keeps your home and resume-seeded role unless you choose otherwise." highlight={wizard && step === 3}>
            <ul className="space-y-1 text-xs">
              {presets.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-100 p-1.5">
                  <span className="font-medium text-slate-800">{p.name}</span>{p.system && <span className="rounded bg-slate-100 px-1 text-[10px]">system</span>}
                  <span className="basis-full text-slate-500 md:basis-auto md:flex-1">{p.description}</span>
                  <button disabled={Boolean(busy)} onClick={() => applyPreset(p.id, false)} className="link disabled:opacity-40">apply</button>
                  <button disabled={Boolean(busy)} onClick={() => { if (confirm('Also replace your home country/metros/timezone/currency with the preset\'s?')) applyPreset(p.id, true) }} className="link disabled:opacity-40">apply + home</button>
                  {!p.system && <button onClick={async () => { await apiClient.deletePreset(p.id); await load() }} className="text-rose-600 hover:underline">delete</button>}
                </li>
              ))}
            </ul>
            <form className="mt-2 flex gap-2 text-xs" onSubmit={async (e) => { e.preventDefault(); if (!presetName.trim()) return; try { await apiClient.savePreset(presetName, doc); setPresetName(''); await load() } catch (x) { setError((x as Error).message) } }}>
              <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="save current as preset…" className="input input-sm flex-1" />
              <button className="btn btn-secondary btn-md">Save preset</button>
            </form>
          </Section>

          {/* History */}
          <Section title="History" hint={`Version ${saved.version} is active (${saved.source}). Reverting creates a new version.`}>
            <ul className="space-y-1 text-xs">
              {history.map((h) => (
                <li key={h.id} className="flex items-center gap-2">
                  <span className="w-8 font-mono text-slate-500">v{h.version}</span>
                  <span className="text-slate-700">{h.source}{h.note ? ` · ${h.note}` : ''}</span>
                  <span className="ml-auto text-slate-400">{new Date(h.changedAt).toLocaleString()}</span>
                  {h.version !== saved.version && <button disabled={Boolean(busy)} onClick={async () => { setBusy('Reverting…'); try { const s = await apiClient.revertPreferences(h.version); if (s.taskId) await apiClient.waitTask(s.taskId).catch(() => undefined); await load() } finally { setBusy(null) } }} className="link disabled:opacity-40">revert</button>}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </AppShell>
  )
}

const INPUT = 'input input-sm'
function Section({ title, hint, highlight, children }: { title: string; hint?: string; highlight?: boolean; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border bg-white p-5 ${highlight ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'}`}>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {hint && <p className="mb-3 text-xs text-slate-500">{hint}</p>}
      {children}
    </section>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-[11px] text-slate-500">{label}<div className="mt-0.5">{children}</div></label>
}
function MultiSelect({ value, options, onChange }: { value: string[]; options: Array<{ id: string; label: string }>; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('')
  const shown = options.filter((o) => !value.includes(o.id) && (!q || o.label.toLowerCase().includes(q.toLowerCase()))).slice(0, 8)
  return (
    <div className="rounded-md border border-slate-200 p-1 text-xs">
      <div className="flex flex-wrap gap-1">
        {value.map((v) => <span key={v} className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5">{options.find((o) => o.id === v)?.label ?? v}<button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="text-slate-500">×</button></span>)}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={value.length ? '' : 'type to add…'} className="min-w-[80px] flex-1 px-1 py-0.5 outline-none" />
      </div>
      {q && shown.length > 0 && <div className="mt-1 flex flex-wrap gap-1 border-t border-slate-100 pt-1">{shown.map((o) => <button key={o.id} type="button" onClick={() => { onChange([...value, o.id]); setQ('') }} className="btn btn-secondary btn-xs">{o.label}</button>)}</div>}
    </div>
  )
}
