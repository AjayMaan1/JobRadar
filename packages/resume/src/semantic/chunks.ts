import type { ResumeContent } from '../schema/resume.js'
import type { JobRequirementsData } from '../jd/types.js'

export interface Chunk { key: string; text: string }

const MAX_CHUNK = 1800

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Split long text into ~MAX_CHUNK-char pieces on paragraph/sentence boundaries. */
export function splitText(text: string, max = MAX_CHUNK): string[] {
  const out: string[] = []
  let cur = ''
  for (const para of text.split(/\n{2,}|\n(?=#)/)) {
    const p = para.trim()
    if (!p) continue
    if ((cur + '\n' + p).length > max && cur) { out.push(cur.trim()); cur = '' }
    if (p.length > max) {
      for (const sent of p.split(/(?<=[.!?])\s+/)) {
        if ((cur + ' ' + sent).length > max && cur) { out.push(cur.trim()); cur = '' }
        cur += ' ' + sent
      }
    } else cur += '\n' + p
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Job → chunks: one "head" (title + requirements summary) plus description pieces. */
export function jobChunks(job: { title: string; company: string; description: string | null }, reqs?: JobRequirementsData | null): Chunk[] {
  const head = [`${job.title} at ${job.company}`, reqs?.required.length ? `Requires: ${reqs.required.map((r) => r.skill).join(', ')}` : '', reqs?.preferred.length ? `Nice to have: ${reqs.preferred.map((r) => r.skill).join(', ')}` : '', reqs?.keywords.length ? `Domain: ${reqs.keywords.map((k) => k.term).join(', ')}` : ''].filter(Boolean).join('. ')
  const chunks: Chunk[] = [{ key: 'head', text: clean(head).slice(0, MAX_CHUNK) }]
  splitText(job.description ?? '').slice(0, 6).forEach((t, i) => chunks.push({ key: `desc:${i}`, text: clean(t) }))
  return chunks
}

/** Resume → chunks: summary, every bullet (with its role as context), skills groups, projects. */
export function resumeChunks(c: ResumeContent): Chunk[] {
  const out: Chunk[] = []
  const headline = [c.basics.label, c.basics.summary].filter(Boolean).join('. ')
  if (headline) out.push({ key: 'summary', text: clean(headline).slice(0, MAX_CHUNK) })
  c.work.forEach((w, i) => {
    const ctx = `${w.position} at ${w.name}`
    if (w.summary) out.push({ key: `work/${i}/summary`, text: clean(`${ctx}: ${w.summary}`) })
    w.highlights.forEach((h, j) => out.push({ key: `work/${i}/highlights/${j}`, text: clean(`${ctx}: ${h}`) }))
    if (w.keywords.length) out.push({ key: `work/${i}/keywords`, text: clean(`${ctx}. Technologies: ${w.keywords.join(', ')}`) })
  })
  c.projects.forEach((p, i) => {
    const ctx = `Project ${p.name}`
    if (p.description) out.push({ key: `projects/${i}/description`, text: clean(`${ctx}: ${p.description}`) })
    p.highlights.forEach((h, j) => out.push({ key: `projects/${i}/highlights/${j}`, text: clean(`${ctx}: ${h}`) }))
  })
  c.skills.forEach((g, i) => { if (g.keywords.length) out.push({ key: `skills/${i}`, text: clean(`${g.name || 'Skills'}: ${g.keywords.join(', ')}`) }) })
  return out
}

/** Profile → one vector: headline + targets + skills. */
export function profileChunks(p: { headline: string | null; about: string | null; targetTitles: string[]; skills: Array<{ canonical?: string; name?: string }> }): Chunk[] {
  const text = [p.headline, p.targetTitles.length ? `Target roles: ${p.targetTitles.join(', ')}` : '', p.skills.length ? `Skills: ${p.skills.map((s) => s.canonical ?? s.name).filter(Boolean).join(', ')}` : '', p.about].filter(Boolean).join('. ')
  return text ? [{ key: 'profile', text: clean(text).slice(0, MAX_CHUNK) }] : []
}

/** Requirement phrase for semantic evidence: the skill plus the JD line it came from. */
export function requirementChunks(reqs: JobRequirementsData): Chunk[] {
  return [...reqs.required, ...reqs.preferred].map((r) => ({ key: `req:${r.skill}`, text: clean(`${r.skill}${r.evidence ? `: ${r.evidence}` : ''}`).slice(0, 400) }))
}
