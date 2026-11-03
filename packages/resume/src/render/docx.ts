import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import type { ResumeContent } from '../schema/resume.js'

function fmtRange(start?: string, end?: string): string {
  const f = (d?: string) => (d ? d.replace(/^(\d{4})-(\d{2}).*/, '$2/$1') : '')
  const s = f(start), e = end ? f(end) : start ? 'Present' : ''
  return [s, e].filter(Boolean).join(' – ')
}

/** DOCX twin of the ats-classic template (many ATS prefer .docx). Same section order, real bullet lists. */
export async function renderAtsClassicDocx(c: ResumeContent): Promise<Buffer> {
  const b = c.basics
  const P = (text: string, o: { bold?: boolean; size?: number; color?: string; after?: number } = {}) =>
    new Paragraph({ spacing: { after: o.after ?? 60 }, children: [new TextRun({ text, bold: o.bold, size: o.size ?? 21, color: o.color })] })
  const H2 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22 })] })
  const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text, size: 21 })] })

  const children: Paragraph[] = []
  children.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 40 }, children: [new TextRun({ text: b.name, bold: true, size: 40 })] }))
  if (b.label) children.push(P(b.label, { bold: true, size: 23 }))
  const contact = [b.email, b.phone, [b.location?.city, b.location?.region, b.location?.countryCode].filter(Boolean).join(', '), b.url, ...b.profiles.map((p) => p.url ?? '')].filter(Boolean).join('  |  ')
  if (contact) children.push(P(contact, { size: 19, color: '333333', after: 160 }))

  if (b.summary) { children.push(H2('Summary')); children.push(P(b.summary)) }
  if (c.work.length) {
    children.push(H2('Experience'))
    for (const w of c.work) {
      children.push(P(`${w.position}${w.position && w.name ? ' — ' : ''}${w.name}`, { bold: true, after: 20 }))
      children.push(P([fmtRange(w.startDate, w.endDate), w.location].filter(Boolean).join(' · '), { size: 19, color: '333333' }))
      if (w.summary) children.push(P(w.summary))
      for (const h of w.highlights) children.push(bullet(h))
      if (w.keywords.length) children.push(P(`Technologies: ${w.keywords.join(', ')}`, { size: 19, color: '333333', after: 120 }))
    }
  }
  if (c.projects.length) {
    children.push(H2('Projects'))
    for (const p of c.projects) {
      children.push(P(`${p.name}${p.url ? ` — ${p.url}` : ''}`, { bold: true, after: 20 }))
      if (p.description) children.push(P(p.description))
      for (const h of p.highlights) children.push(bullet(h))
      if (p.keywords.length) children.push(P(`Technologies: ${p.keywords.join(', ')}`, { size: 19, color: '333333', after: 120 }))
    }
  }
  if (c.skills.length) {
    children.push(H2('Skills'))
    for (const g of c.skills) children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: `${g.name || 'Skills'}: `, bold: true, size: 21 }), new TextRun({ text: g.keywords.join(', '), size: 21 })] }))
  }
  if (c.education.length) {
    children.push(H2('Education'))
    for (const e of c.education) children.push(P(`${[e.studyType, e.area].filter(Boolean).join(', ')}${e.institution ? ` — ${e.institution}` : ''}${e.endDate || e.startDate ? ` (${fmtRange(e.startDate, e.endDate)})` : ''}${e.score ? ` · ${e.score}` : ''}`))
  }
  if (c.certificates.length) {
    children.push(H2('Certifications'))
    for (const x of c.certificates) children.push(bullet(`${x.name}${x.issuer ? ` — ${x.issuer}` : ''}${x.date ? ` (${x.date})` : ''}`))
  }
  if (c.languages.length) { children.push(H2('Languages')); children.push(P(c.languages.map((l) => [l.language, l.fluency].filter(Boolean).join(' — ')).join(', '))) }
  for (const s of c.sections) if (s.title && s.items.length) { children.push(H2(s.title)); for (const i of s.items) children.push(bullet(i)) }

  const doc = new Document({
    creator: 'JobRadar',
    styles: { default: { document: { run: { font: 'Arial', size: 21 } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } }, children }],
  })
  return Buffer.from(await Packer.toBuffer(doc))
}
