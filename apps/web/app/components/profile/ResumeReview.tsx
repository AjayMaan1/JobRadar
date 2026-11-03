'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '../../../lib/api-client'
import type { ResumeContent, ResumeDetail } from '../../../lib/api-client'
import { Badge, SegmentedControl } from '../ui'

/**
 * Side-by-side parse review: extracted text on the left, editable structured content on the right.
 * Saving creates a new immutable "correction" version (the original parse is never overwritten).
 */
export function ResumeReview({ detail, onSaved }: { detail: ResumeDetail; onSaved: () => Promise<void> }) {
  const [content, setContent] = useState<ResumeContent | null>(detail.current?.content ?? null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [tab, setTab] = useState<'edit' | 'json'>('edit')

  useEffect(() => { setContent(detail.current?.content ?? null); setDirty(false) }, [detail])

  function update(fn: (c: ResumeContent) => ResumeContent) {
    setContent((c) => (c ? fn(structuredClone(c)) : c))
    setDirty(true)
  }

  async function save() {
    if (!content) return
    setSaving(true); setMsg(null)
    try {
      await apiClient.patchResume(detail.resume.id, { content })
      setMsg('Saved as a new version ✓')
      setDirty(false)
      await onSaved()
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const warnings = detail.resume.parseWarnings ?? []

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
        <div>
          <h2 className="font-semibold text-slate-900 text-sm">{detail.resume.label} — parse review</h2>
          <p className="text-xs text-slate-400">{detail.versions.length} version(s) · current: {detail.current?.kind ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl value={tab} onChange={setTab} options={[{ id: 'edit', label: 'Form' }, { id: 'json', label: 'JSON' }]} />
          <a href={`/resumes/${detail.resume.id}/edit`} className="btn btn-secondary btn-sm" title="Visual editor with live preview">Open editor</a>
          <button onClick={save} disabled={!dirty || saving} className="btn btn-primary btn-sm">{saving ? 'Saving…' : 'Save corrections'}</button>
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="border-b border-slate-100 bg-amber-50/60 p-3 space-y-1">
          {warnings.map((w) => (
            <li key={w.code} className="text-xs text-slate-700">
              <Badge tone={w.severity === 'error' ? 'danger' : w.severity === 'warn' ? 'warning' : 'neutral'} className="mr-2 uppercase">{w.severity}</Badge>
              {w.message}
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="px-4 pt-2 text-xs text-slate-500">{msg}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-slate-100">
        <div className="p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Extracted text (what an ATS sees)</p>
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">{detail.resume.rawText ?? '—'}</pre>
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Structured content</p>
          {!content ? (
            <p className="text-sm text-slate-400">No parsed content yet.</p>
          ) : tab === 'json' ? (
            <textarea
              className="input input-sm h-[70vh] w-full font-mono"
              value={JSON.stringify(content, null, 2)}
              onChange={(e) => { try { setContent(JSON.parse(e.target.value)); setDirty(true); setMsg(null) } catch { setMsg('Invalid JSON') } }}
            />
          ) : (
            <div className="max-h-[70vh] overflow-auto pr-1">
              <Editor content={content} update={update} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, rows }: { label: string; value: string | undefined; onChange: (v: string) => void; rows?: number }) {
  const cls = 'input input-sm mt-0.5'
  return (
    <label className="block text-[11px] text-slate-500">
      {label}
      {rows ? <textarea rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls} /> : <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls} />}
    </label>
  )
}

function Lines({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return <Field label={`${label} (one per line)`} value={value.join('\n')} rows={Math.max(3, value.length + 1)} onChange={(v) => onChange(v.split('\n').map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean))} />
}

function Csv({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return <Field label={`${label} (comma-separated)`} value={value.join(', ')} onChange={(v) => onChange(v.split(',').map((s) => s.trim()).filter(Boolean))} />
}

function Section({ title, children, onAdd }: { title: string; children: React.ReactNode; onAdd?: () => void }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
        {onAdd && <button onClick={onAdd} className="text-xs link">+ add</button>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Card({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="relative space-y-1.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <button onClick={onRemove} className="absolute right-2 top-1 text-xs text-slate-400 hover:text-rose-500">remove</button>
      {children}
    </div>
  )
}

function Editor({ content, update }: { content: ResumeContent; update: (fn: (c: ResumeContent) => ResumeContent) => void }) {
  const b = content.basics
  return (
    <div>
      <Section title="Basics">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name" value={b.name} onChange={(v) => update((c) => { c.basics.name = v; return c })} />
          <Field label="Headline" value={b.label} onChange={(v) => update((c) => { c.basics.label = v; return c })} />
          <Field label="Email" value={b.email} onChange={(v) => update((c) => { c.basics.email = v; return c })} />
          <Field label="Phone" value={b.phone} onChange={(v) => update((c) => { c.basics.phone = v; return c })} />
          <Field label="URL" value={b.url} onChange={(v) => update((c) => { c.basics.url = v; return c })} />
          <Field label="City" value={b.location?.city} onChange={(v) => update((c) => { c.basics.location = { ...(c.basics.location ?? {}), city: v }; return c })} />
        </div>
        <Field label="Summary / About" value={b.summary} rows={4} onChange={(v) => update((c) => { c.basics.summary = v; return c })} />
      </Section>

      <Section title="Experience" onAdd={() => update((c) => { c.work.unshift({ name: '', position: '', highlights: [], keywords: [] }); return c })}>
        {content.work.map((w, i) => (
          <Card key={i} onRemove={() => update((c) => { c.work.splice(i, 1); return c })}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Position" value={w.position} onChange={(v) => update((c) => { c.work[i].position = v; return c })} />
              <Field label="Company" value={w.name} onChange={(v) => update((c) => { c.work[i].name = v; return c })} />
              <Field label="Start (YYYY-MM)" value={w.startDate} onChange={(v) => update((c) => { c.work[i].startDate = v; return c })} />
              <Field label="End (YYYY-MM, blank = present)" value={w.endDate} onChange={(v) => update((c) => { c.work[i].endDate = v; return c })} />
            </div>
            <Field label="Summary" value={w.summary} rows={2} onChange={(v) => update((c) => { c.work[i].summary = v; return c })} />
            <Lines label="Bullets" value={w.highlights} onChange={(v) => update((c) => { c.work[i].highlights = v; return c })} />
            <Csv label="Technologies" value={w.keywords} onChange={(v) => update((c) => { c.work[i].keywords = v; return c })} />
          </Card>
        ))}
      </Section>

      <Section title="Skills" onAdd={() => update((c) => { c.skills.push({ name: 'Skills', keywords: [] }); return c })}>
        {content.skills.map((g, i) => (
          <Card key={i} onRemove={() => update((c) => { c.skills.splice(i, 1); return c })}>
            <Field label="Group" value={g.name} onChange={(v) => update((c) => { c.skills[i].name = v; return c })} />
            <Csv label="Skills" value={g.keywords} onChange={(v) => update((c) => { c.skills[i].keywords = v; return c })} />
          </Card>
        ))}
      </Section>

      <Section title="Education" onAdd={() => update((c) => { c.education.push({ institution: '', courses: [] }); return c })}>
        {content.education.map((e, i) => (
          <Card key={i} onRemove={() => update((c) => { c.education.splice(i, 1); return c })}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Institution" value={e.institution} onChange={(v) => update((c) => { c.education[i].institution = v; return c })} />
              <Field label="Degree" value={e.studyType} onChange={(v) => update((c) => { c.education[i].studyType = v; return c })} />
              <Field label="Field" value={e.area} onChange={(v) => update((c) => { c.education[i].area = v; return c })} />
              <Field label="End (YYYY)" value={e.endDate} onChange={(v) => update((c) => { c.education[i].endDate = v; return c })} />
            </div>
          </Card>
        ))}
      </Section>

      <Section title="Projects" onAdd={() => update((c) => { c.projects.push({ name: '', highlights: [], keywords: [] }); return c })}>
        {content.projects.map((p, i) => (
          <Card key={i} onRemove={() => update((c) => { c.projects.splice(i, 1); return c })}>
            <Field label="Name" value={p.name} onChange={(v) => update((c) => { c.projects[i].name = v; return c })} />
            <Field label="Description" value={p.description} rows={2} onChange={(v) => update((c) => { c.projects[i].description = v; return c })} />
            <Lines label="Bullets" value={p.highlights} onChange={(v) => update((c) => { c.projects[i].highlights = v; return c })} />
            <Csv label="Technologies" value={p.keywords} onChange={(v) => update((c) => { c.projects[i].keywords = v; return c })} />
          </Card>
        ))}
      </Section>

      <Section title="Certificates" onAdd={() => update((c) => { c.certificates.push({ name: '' }); return c })}>
        {content.certificates.map((x, i) => (
          <Card key={i} onRemove={() => update((c) => { c.certificates.splice(i, 1); return c })}>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Name" value={x.name} onChange={(v) => update((c) => { c.certificates[i].name = v; return c })} />
              <Field label="Issuer" value={x.issuer} onChange={(v) => update((c) => { c.certificates[i].issuer = v; return c })} />
              <Field label="Date" value={x.date} onChange={(v) => update((c) => { c.certificates[i].date = v; return c })} />
            </div>
          </Card>
        ))}
      </Section>

      <Section title="Other sections" onAdd={() => update((c) => { c.sections.push({ title: '', items: [] }); return c })}>
        {content.sections.map((s, i) => (
          <Card key={i} onRemove={() => update((c) => { c.sections.splice(i, 1); return c })}>
            <Field label="Title" value={s.title} onChange={(v) => update((c) => { c.sections[i].title = v; return c })} />
            <Lines label="Items" value={s.items} onChange={(v) => update((c) => { c.sections[i].items = v; return c })} />
          </Card>
        ))}
      </Section>
    </div>
  )
}
