import type { ResumeContent } from '../schema/resume.js'

/**
 * "ats-classic": single column, standard headings, text contact line, system fonts, no tables/columns/icons.
 * Deliberately boring — every line must survive a naive text extraction in reading order.
 */
export const TEMPLATE_VERSION = 'ats-classic-v1'

const esc = (s: string | undefined | null): string =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fmtDate(d: string | undefined): string {
  if (!d) return ''
  const m = d.match(/^(\d{4})(?:-(\d{2}))?/)
  if (!m) return d
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return m[2] ? `${months[parseInt(m[2], 10) - 1]} ${m[1]}` : m[1]
}

function range(start?: string, end?: string): string {
  const s = fmtDate(start)
  const e = end ? fmtDate(end) : start ? 'Present' : ''
  return [s, e].filter(Boolean).join(' – ')
}

const CSS = `
  @page { size: A4; margin: 16mm 16mm 16mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, "Liberation Sans", sans-serif; font-size: 10.5pt; line-height: 1.35; color: #111; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 2pt 0; letter-spacing: 0.2pt; }
  .headline { font-size: 11.5pt; font-weight: 600; margin: 0 0 3pt 0; }
  .contact { font-size: 9.5pt; color: #333; margin: 0 0 10pt 0; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.8pt; border-bottom: 1px solid #222; padding-bottom: 2pt; margin: 12pt 0 6pt 0; }
  .role { margin: 0 0 6pt 0; }
  .role-head { display: block; font-weight: 700; }
  .role-meta { display: block; font-size: 9.5pt; color: #333; margin-bottom: 2pt; }
  ul { margin: 2pt 0 0 0; padding-left: 14pt; }
  li { margin: 0 0 2pt 0; }
  p { margin: 0 0 4pt 0; }
  .skills p { margin: 0 0 2pt 0; }
  .edu { margin: 0 0 4pt 0; }
`

export function renderAtsClassicHtml(c: ResumeContent): string {
  const b = c.basics
  const contact = [b.email, b.phone, [b.location?.city, b.location?.region, b.location?.countryCode].filter(Boolean).join(', '), b.url, ...b.profiles.map((p) => p.url ?? p.username ?? '')].filter(Boolean).map(esc).join('  |  ')
  const parts: string[] = []
  parts.push(`<h1>${esc(b.name)}</h1>`)
  if (b.label) parts.push(`<p class="headline">${esc(b.label)}</p>`)
  if (contact) parts.push(`<p class="contact">${contact}</p>`)

  const sections: Record<string, () => string> = {
    summary: () => (b.summary ? `<h2>Summary</h2><p>${esc(b.summary)}</p>` : ''),
    work: () =>
      c.work.length
        ? `<h2>Experience</h2>` +
          c.work
            .map(
              (w) => `<div class="role"><span class="role-head">${esc(w.position)}${w.position && w.name ? ' — ' : ''}${esc(w.name)}</span><span class="role-meta">${esc(range(w.startDate, w.endDate))}${w.location ? ` · ${esc(w.location)}` : ''}</span>${w.summary ? `<p>${esc(w.summary)}</p>` : ''}${w.highlights.length ? `<ul>${w.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}${w.keywords.length ? `<p class="role-meta">Technologies: ${esc(w.keywords.join(', '))}</p>` : ''}</div>`
            )
            .join('')
        : '',
    projects: () =>
      c.projects.length
        ? `<h2>Projects</h2>` +
          c.projects.map((p) => `<div class="role"><span class="role-head">${esc(p.name)}${p.url ? ` — ${esc(p.url)}` : ''}</span>${p.description ? `<p>${esc(p.description)}</p>` : ''}${p.highlights.length ? `<ul>${p.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}${p.keywords.length ? `<p class="role-meta">Technologies: ${esc(p.keywords.join(', '))}</p>` : ''}</div>`).join('')
        : '',
    skills: () => (c.skills.length ? `<h2>Skills</h2><div class="skills">${c.skills.map((g) => `<p><strong>${esc(g.name || 'Skills')}:</strong> ${esc(g.keywords.join(', '))}</p>`).join('')}</div>` : ''),
    education: () =>
      c.education.length
        ? `<h2>Education</h2>` + c.education.map((e) => `<p class="edu"><strong>${esc([e.studyType, e.area].filter(Boolean).join(', '))}</strong>${e.institution ? ` — ${esc(e.institution)}` : ''}${e.endDate || e.startDate ? ` (${esc(range(e.startDate, e.endDate))})` : ''}${e.score ? ` · ${esc(e.score)}` : ''}</p>`).join('')
        : '',
    certificates: () => (c.certificates.length ? `<h2>Certifications</h2><ul>${c.certificates.map((x) => `<li>${esc(x.name)}${x.issuer ? ` — ${esc(x.issuer)}` : ''}${x.date ? ` (${esc(fmtDate(x.date))})` : ''}</li>`).join('')}</ul>` : ''),
    languages: () => (c.languages.length ? `<h2>Languages</h2><p>${esc(c.languages.map((l) => [l.language, l.fluency].filter(Boolean).join(' — ')).join(', '))}</p>` : ''),
  }
  const order = ['summary', 'work', 'projects', 'skills', 'education', 'certificates', 'languages']
  for (const key of order) parts.push(sections[key]())
  for (const s of c.sections) if (s.title && s.items.length) parts.push(`<h2>${esc(s.title)}</h2><ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`)

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(b.name)} — Resume</title><style>${CSS}</style></head><body>${parts.join('\n')}</body></html>`
}
