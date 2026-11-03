'use client'

import { useState } from 'react'
import { bulletsToText, keywordsToText, textToBullets, textToKeywords } from '@jobradar/resume/client'
import type { ChangeGrounding, ParseWarning, ResumeContent } from '@jobradar/resume/client'

/**
 * Structured form over the JSON-Resume document. Every control edits one JSON-pointer path (`onEdit`) so the
 * change log stays attributable; list operations (add/remove/move) replace the whole draft.
 * Grounding flags (claims not in the master resume) appear inline next to the field they belong to.
 */
interface Props {
  draft: ResumeContent
  onEdit: (pointer: string, value: unknown) => void
  onReplace: (draft: ResumeContent) => void
  grounding: ChangeGrounding[]
  warnings: ParseWarning[]
}

const INPUT = 'w-full rounded-md border border-slate-200 px-2 py-1 text-xs'
const TA = `${INPUT} font-mono leading-relaxed`

export function EditorForm({ draft, onEdit, onReplace, grounding, warnings }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({ basics: true, work: true, skills: true })
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !(o[k] ?? false) }))
  const flag = (pointerPrefix: string) => grounding.filter((g) => g.path === pointerPrefix || g.path.startsWith(pointerPrefix + '/'))
  const move = <T,>(arr: T[], i: number, d: number): T[] => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a }
  const b = draft.basics

  return (
    <div className="space-y-3 text-xs">
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
          Upload parse warnings (affect the parseability component): {warnings.map((w) => w.code).join(', ')}. Rendered versions use the single-column template, which clears layout warnings.
        </div>
      )}

      <Section id="basics" title="Basics" open={open.basics ?? true} toggle={toggle}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name"><input value={b.name} onChange={(e) => onEdit('/basics/name', e.target.value)} className={INPUT} /></Field>
          <Field label="Headline" flags={flag('/basics/label')}><input value={b.label ?? ''} onChange={(e) => onEdit('/basics/label', e.target.value)} className={INPUT} /></Field>
          <Field label="Email"><input value={b.email ?? ''} onChange={(e) => onEdit('/basics/email', e.target.value)} className={INPUT} /></Field>
          <Field label="Phone"><input value={b.phone ?? ''} onChange={(e) => onEdit('/basics/phone', e.target.value)} className={INPUT} /></Field>
          <Field label="Website"><input value={b.url ?? ''} onChange={(e) => onEdit('/basics/url', e.target.value)} className={INPUT} /></Field>
          <Field label="Location (city, region, country)"><input value={[b.location?.city, b.location?.region, b.location?.countryCode].filter(Boolean).join(', ')} onChange={(e) => { const [city, region, countryCode] = e.target.value.split(',').map((s) => s.trim()); onEdit('/basics/location', { city: city || undefined, region: region || undefined, countryCode: countryCode || undefined }) }} className={INPUT} /></Field>
        </div>
        <Field label="Summary / About" flags={flag('/basics/summary')}><textarea rows={4} value={b.summary ?? ''} onChange={(e) => onEdit('/basics/summary', e.target.value)} className={TA} /></Field>
        <Field label="Links (one per line: Network — URL)">
          <textarea rows={Math.max(2, b.profiles.length + 1)} value={b.profiles.map((p) => `${p.network} — ${p.url ?? ''}`).join('\n')} onChange={(e) => onEdit('/basics/profiles', e.target.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [network, url] = l.split(/\s+—\s+|\s+-\s+/); return { network: network?.trim() ?? '', url: url?.trim() || undefined } }))} className={TA} />
        </Field>
      </Section>

      <Section id="work" title={`Experience (${draft.work.length})`} open={open.work ?? true} toggle={toggle} onAdd={() => onReplace({ ...draft, work: [...draft.work, { name: '', position: '', highlights: [], keywords: [] }] })}>
        {draft.work.map((w, i) => (
          <Card key={i} title={`${w.position || 'Role'}${w.name ? ` @ ${w.name}` : ''}`} onRemove={() => onReplace({ ...draft, work: draft.work.filter((_, j) => j !== i) })} onUp={i > 0 ? () => onReplace({ ...draft, work: move(draft.work, i, -1) }) : undefined} onDown={i < draft.work.length - 1 ? () => onReplace({ ...draft, work: move(draft.work, i, 1) }) : undefined}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Title"><input value={w.position} onChange={(e) => onEdit(`/work/${i}/position`, e.target.value)} className={INPUT} /></Field>
              <Field label="Employer"><input value={w.name} onChange={(e) => onEdit(`/work/${i}/name`, e.target.value)} className={INPUT} /></Field>
              <Field label="Start (YYYY-MM)"><input value={w.startDate ?? ''} onChange={(e) => onEdit(`/work/${i}/startDate`, e.target.value)} className={INPUT} placeholder="2021-03" /></Field>
              <Field label="End (blank = present)"><input value={w.endDate ?? ''} onChange={(e) => onEdit(`/work/${i}/endDate`, e.target.value)} className={INPUT} /></Field>
              <Field label="Location"><input value={w.location ?? ''} onChange={(e) => onEdit(`/work/${i}/location`, e.target.value)} className={INPUT} /></Field>
              <Field label="Technologies (comma-separated)"><input value={keywordsToText(w.keywords)} onChange={(e) => onEdit(`/work/${i}/keywords`, textToKeywords(e.target.value))} className={INPUT} /></Field>
            </div>
            <Field label="Summary" flags={flag(`/work/${i}/summary`)}><textarea rows={2} value={w.summary ?? ''} onChange={(e) => onEdit(`/work/${i}/summary`, e.target.value)} className={TA} /></Field>
            <Field label={`Bullets (one per line · ${w.highlights.length})`} flags={flag(`/work/${i}/highlights`)}><textarea rows={Math.min(12, Math.max(3, w.highlights.length + 1))} value={bulletsToText(w.highlights)} onChange={(e) => onEdit(`/work/${i}/highlights`, textToBullets(e.target.value))} className={TA} /></Field>
          </Card>
        ))}
      </Section>

      <Section id="skills" title={`Skills (${draft.skills.length} groups)`} open={open.skills ?? true} toggle={toggle} onAdd={() => onReplace({ ...draft, skills: [...draft.skills, { name: 'Skills', keywords: [] }] })}>
        {draft.skills.map((g, i) => (
          <Card key={i} title={g.name || 'Group'} onRemove={() => onReplace({ ...draft, skills: draft.skills.filter((_, j) => j !== i) })}>
            <div className="grid grid-cols-[1fr_3fr] gap-2">
              <Field label="Group"><input value={g.name} onChange={(e) => onEdit(`/skills/${i}/name`, e.target.value)} className={INPUT} /></Field>
              <Field label="Keywords (comma-separated)" flags={flag(`/skills/${i}/keywords`)}><input value={keywordsToText(g.keywords)} onChange={(e) => onEdit(`/skills/${i}/keywords`, textToKeywords(e.target.value))} className={INPUT} /></Field>
            </div>
          </Card>
        ))}
      </Section>

      <Section id="education" title={`Education (${draft.education.length})`} open={open.education ?? false} toggle={toggle} onAdd={() => onReplace({ ...draft, education: [...draft.education, { institution: '', courses: [] }] })}>
        {draft.education.map((ed, i) => (
          <Card key={i} title={ed.institution || 'Institution'} onRemove={() => onReplace({ ...draft, education: draft.education.filter((_, j) => j !== i) })}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Institution"><input value={ed.institution} onChange={(e) => onEdit(`/education/${i}/institution`, e.target.value)} className={INPUT} /></Field>
              <Field label="Degree"><input value={ed.studyType ?? ''} onChange={(e) => onEdit(`/education/${i}/studyType`, e.target.value)} className={INPUT} /></Field>
              <Field label="Field"><input value={ed.area ?? ''} onChange={(e) => onEdit(`/education/${i}/area`, e.target.value)} className={INPUT} /></Field>
              <Field label="Years (start / end)"><div className="flex gap-1"><input value={ed.startDate ?? ''} onChange={(e) => onEdit(`/education/${i}/startDate`, e.target.value)} className={INPUT} placeholder="2014" /><input value={ed.endDate ?? ''} onChange={(e) => onEdit(`/education/${i}/endDate`, e.target.value)} className={INPUT} placeholder="2018" /></div></Field>
            </div>
          </Card>
        ))}
      </Section>

      <Section id="projects" title={`Projects (${draft.projects.length})`} open={open.projects ?? false} toggle={toggle} onAdd={() => onReplace({ ...draft, projects: [...draft.projects, { name: '', highlights: [], keywords: [] }] })}>
        {draft.projects.map((p, i) => (
          <Card key={i} title={p.name || 'Project'} onRemove={() => onReplace({ ...draft, projects: draft.projects.filter((_, j) => j !== i) })}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name"><input value={p.name} onChange={(e) => onEdit(`/projects/${i}/name`, e.target.value)} className={INPUT} /></Field>
              <Field label="URL"><input value={p.url ?? ''} onChange={(e) => onEdit(`/projects/${i}/url`, e.target.value)} className={INPUT} /></Field>
            </div>
            <Field label="Description" flags={flag(`/projects/${i}/description`)}><textarea rows={2} value={p.description ?? ''} onChange={(e) => onEdit(`/projects/${i}/description`, e.target.value)} className={TA} /></Field>
            <Field label="Bullets (one per line)" flags={flag(`/projects/${i}/highlights`)}><textarea rows={3} value={bulletsToText(p.highlights)} onChange={(e) => onEdit(`/projects/${i}/highlights`, textToBullets(e.target.value))} className={TA} /></Field>
            <Field label="Technologies"><input value={keywordsToText(p.keywords)} onChange={(e) => onEdit(`/projects/${i}/keywords`, textToKeywords(e.target.value))} className={INPUT} /></Field>
          </Card>
        ))}
      </Section>

      <Section id="certs" title={`Certificates (${draft.certificates.length}) · Languages (${draft.languages.length}) · Other (${draft.sections.length})`} open={open.certs ?? false} toggle={toggle}>
        <Field label="Certificates (one per line: Name — Issuer — YYYY)" flags={flag('/certificates')}>
          <textarea rows={Math.max(2, draft.certificates.length + 1)} value={draft.certificates.map((c) => [c.name, c.issuer, c.date].filter(Boolean).join(' — ')).join('\n')} onChange={(e) => onEdit('/certificates', e.target.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, issuer, date] = l.split(/\s+—\s+/); return { name: name ?? '', issuer: issuer || undefined, date: date || undefined } }))} className={TA} />
        </Field>
        <Field label="Languages (one per line: Language — fluency)">
          <textarea rows={Math.max(2, draft.languages.length + 1)} value={draft.languages.map((l) => [l.language, l.fluency].filter(Boolean).join(' — ')).join('\n')} onChange={(e) => onEdit('/languages', e.target.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [language, fluency] = l.split(/\s+—\s+/); return { language: language ?? '', fluency: fluency || undefined } }))} className={TA} />
        </Field>
        {draft.sections.map((s, i) => (
          <Card key={i} title={s.title} onRemove={() => onReplace({ ...draft, sections: draft.sections.filter((_, j) => j !== i) })}>
            <Field label="Title"><input value={s.title} onChange={(e) => onEdit(`/sections/${i}/title`, e.target.value)} className={INPUT} /></Field>
            <Field label="Items (one per line)" flags={flag(`/sections/${i}/items`)}><textarea rows={3} value={bulletsToText(s.items)} onChange={(e) => onEdit(`/sections/${i}/items`, textToBullets(e.target.value))} className={TA} /></Field>
          </Card>
        ))}
        <button onClick={() => onReplace({ ...draft, sections: [...draft.sections, { title: 'Awards', items: [] }] })} className="link">+ add a section</button>
      </Section>
    </div>
  )
}

function Section({ id, title, open, toggle, onAdd, children }: { id: string; title: string; open: boolean; toggle: (k: string) => void; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200">
      <div className="flex items-center justify-between bg-slate-50 px-2 py-1.5">
        <button onClick={() => toggle(id)} className="text-xs font-semibold text-slate-800">{open ? '▾' : '▸'} {title}</button>
        {onAdd && <button onClick={onAdd} className="text-[11px] link">+ add</button>}
      </div>
      {open && <div className="space-y-2 p-2">{children}</div>}
    </section>
  )
}
function Card({ title, onRemove, onUp, onDown, children }: { title: string; onRemove: () => void; onUp?: () => void; onDown?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-100 p-2">
      <div className="mb-1 flex items-center gap-2 text-[11px]">
        <span className="flex-1 truncate font-medium text-slate-700">{title}</span>
        {onUp && <button onClick={onUp} className="text-slate-500">↑</button>}
        {onDown && <button onClick={onDown} className="text-slate-500">↓</button>}
        <button onClick={onRemove} className="text-rose-600">remove</button>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}
function Field({ label, flags, children }: { label: string; flags?: ChangeGrounding[]; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] text-slate-500">{label}
      {flags && flags.length > 0 && <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-1 text-[10px] text-amber-800" title={flags.flatMap((f) => f.result.unsupported.map((u) => `${u.kind}: ${u.value}`)).join(' · ')}>⚠ not in your master resume: {flags.flatMap((f) => f.result.unsupported.map((u) => u.value)).slice(0, 3).join(', ')}</span>}
      <div className="mt-0.5">{children}</div>
    </label>
  )
}
