import type { ResumeContent } from '../schema/resume.js'
import type { PdfRenderer } from './pdf.js'

/**
 * Dependency-free PDF renderer: A4, Helvetica, single column, real text (no images, tables or columns).
 * Used when Chromium is not installed (PDF_RENDERER=simple or automatic fallback). Typography is plain —
 * which is exactly what ATS parsers like — and the output round-trips through our own extractor.
 */
const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 48
const BODY = 10, SMALL = 9, H1 = 18, H2 = 11
const LINE = 1.32

// Approximate Helvetica advance widths (per 1pt) for wrapping; good enough for layout.
const AVG: Record<string, number> = { ' ': 0.278, i: 0.222, l: 0.222, j: 0.222, t: 0.278, f: 0.278, r: 0.333, I: 0.278, m: 0.833, w: 0.722, M: 0.833, W: 0.944 }
function width(text: string, size: number): number {
  let w = 0
  for (const ch of text) w += AVG[ch] ?? (ch >= 'A' && ch <= 'Z' ? 0.667 : /[0-9]/.test(ch) ? 0.556 : 0.5)
  return w * size
}

const WINANSI: Record<string, string> = { '–': '\x96', '—': '\x97', '‘': '\x91', '’': '\x92', '“': '\x93', '”': '\x94', '•': '\x95', '…': '\x85', '€': '\x80', '™': '\x99', '©': '\xa9', '®': '\xae', '·': '\xb7', '×': '\xd7', '°': '\xb0', '£': '\xa3', '₹': 'Rs ', '→': '->', '✓': 'v', '★': '*' }
function toWinAnsi(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (code < 128) out += ch
    else if (WINANSI[ch] !== undefined) out += WINANSI[ch]
    else if (code <= 255) out += ch
    else out += ch.normalize('NFKD').replace(/[^\x00-\x7f]/g, '') || '?'
  }
  return out.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function wrap(text: string, size: number, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (width(t, size) > maxW && cur) { lines.push(cur); cur = w } else cur = t
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

interface Op { x: number; y: number; size: number; bold: boolean; text: string }

class Layout {
  pages: Op[][] = [[]]
  y = PAGE_H - MARGIN
  private get page() { return this.pages[this.pages.length - 1] }
  private ensure(h: number) { if (this.y - h < MARGIN) { this.pages.push([]); this.y = PAGE_H - MARGIN } }
  text(text: string, size: number, bold = false, indent = 0, gapAfter = 2) {
    const maxW = PAGE_W - 2 * MARGIN - indent
    for (const line of wrap(text, size, maxW)) {
      this.ensure(size * LINE)
      this.page.push({ x: MARGIN + indent, y: this.y - size, size, bold, text: line })
      this.y -= size * LINE
    }
    this.y -= gapAfter
  }
  bullet(text: string, size = BODY) {
    const maxW = PAGE_W - 2 * MARGIN - 14
    const lines = wrap(text, size, maxW)
    lines.forEach((line, i) => {
      this.ensure(size * LINE)
      if (i === 0) this.page.push({ x: MARGIN + 2, y: this.y - size, size, bold: false, text: '•' })
      this.page.push({ x: MARGIN + 14, y: this.y - size, size, bold: false, text: line })
      this.y -= size * LINE
    })
    this.y -= 1.5
  }
  heading(text: string) {
    this.y -= 6
    this.ensure(H2 * LINE + 4)
    this.page.push({ x: MARGIN, y: this.y - H2, size: H2, bold: true, text: text.toUpperCase() })
    this.y -= H2 * LINE
    this.page.push({ x: MARGIN, y: this.y + 2, size: 0, bold: false, text: '__rule__' })
    this.y -= 4
  }
  space(n: number) { this.y -= n }
}

function fmtDate(d?: string): string {
  if (!d) return ''
  const m = d.match(/^(\d{4})(?:-(\d{2}))?/)
  if (!m) return d
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return m[2] ? `${months[parseInt(m[2], 10) - 1]} ${m[1]}` : m[1]
}
const range = (s?: string, e?: string) => [fmtDate(s), e ? fmtDate(e) : s ? 'Present' : ''].filter(Boolean).join(' – ')

export function layoutResume(c: ResumeContent): Op[][] {
  const L = new Layout()
  const b = c.basics
  L.text(b.name || 'Resume', H1, true, 0, 1)
  if (b.label) L.text(b.label, BODY + 1, true, 0, 1)
  const contact = [b.email, b.phone, [b.location?.city, b.location?.region, b.location?.countryCode].filter(Boolean).join(', '), b.url, ...b.profiles.map((p) => p.url ?? '')].filter(Boolean).join('  |  ')
  if (contact) L.text(contact, SMALL, false, 0, 6)
  if (b.summary) { L.heading('Summary'); L.text(b.summary, BODY) }
  if (c.work.length) {
    L.heading('Experience')
    for (const w of c.work) {
      L.text(`${w.position}${w.position && w.name ? ' — ' : ''}${w.name}`, BODY, true, 0, 0)
      L.text([range(w.startDate, w.endDate), w.location].filter(Boolean).join(' · '), SMALL, false, 0, 2)
      if (w.summary) L.text(w.summary, BODY)
      for (const h of w.highlights) L.bullet(h)
      if (w.keywords.length) L.text(`Technologies: ${w.keywords.join(', ')}`, SMALL, false, 0, 4)
      L.space(3)
    }
  }
  if (c.projects.length) {
    L.heading('Projects')
    for (const p of c.projects) {
      L.text(`${p.name}${p.url ? ` — ${p.url}` : ''}`, BODY, true, 0, 1)
      if (p.description) L.text(p.description, BODY)
      for (const h of p.highlights) L.bullet(h)
      if (p.keywords.length) L.text(`Technologies: ${p.keywords.join(', ')}`, SMALL, false, 0, 4)
    }
  }
  if (c.skills.length) {
    L.heading('Skills')
    for (const g of c.skills) L.text(`${g.name || 'Skills'}: ${g.keywords.join(', ')}`, BODY)
  }
  if (c.education.length) {
    L.heading('Education')
    for (const e of c.education) L.text(`${[e.studyType, e.area].filter(Boolean).join(', ')}${e.institution ? ` — ${e.institution}` : ''}${e.endDate || e.startDate ? ` (${range(e.startDate, e.endDate)})` : ''}${e.score ? ` · ${e.score}` : ''}`, BODY)
  }
  if (c.certificates.length) { L.heading('Certifications'); for (const x of c.certificates) L.bullet(`${x.name}${x.issuer ? ` — ${x.issuer}` : ''}${x.date ? ` (${fmtDate(x.date)})` : ''}`) }
  if (c.languages.length) { L.heading('Languages'); L.text(c.languages.map((l) => [l.language, l.fluency].filter(Boolean).join(' — ')).join(', '), BODY) }
  for (const s of c.sections) if (s.title && s.items.length) { L.heading(s.title); for (const i of s.items) L.bullet(i) }
  return L.pages
}

/** Serialise laid-out pages to PDF 1.4 bytes. */
export function pagesToPdf(pages: Op[][], title = 'Resume'): Buffer {
  const objects: string[] = []
  const add = (body: string) => { objects.push(body); return objects.length }
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const contentIds: number[] = []
  for (const ops of pages) {
    let stream = ''
    for (const op of ops) {
      if (op.text === '__rule__') { stream += `q 0.5 w 0.2 G ${MARGIN} ${op.y.toFixed(1)} m ${(PAGE_W - MARGIN).toFixed(1)} ${op.y.toFixed(1)} l S Q\n`; continue }
      stream += `BT /${op.bold ? 'F2' : 'F1'} ${op.size} Tf ${op.x.toFixed(1)} ${op.y.toFixed(1)} Td (${toWinAnsi(op.text)}) Tj ET\n`
    }
    contentIds.push(add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`))
  }
  const pagesRef = objects.length + pages.length + 1
  const pageIds = contentIds.map((cid) => add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cid} 0 R >>`))
  const realPages = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  if (realPages !== pagesRef) throw new Error('pdf: pages ref mismatch')
  const info = add(`<< /Title (${toWinAnsi(title)}) /Producer (JobRadar simple renderer) >>`)
  const catalog = add(`<< /Type /Catalog /Pages ${realPages} 0 R >>`)
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets: number[] = []
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

export function renderSimplePdf(c: ResumeContent): Buffer {
  return pagesToPdf(layoutResume(c), `${c.basics.name || 'Resume'} — Resume`)
}

/** PdfRenderer that ignores the HTML and lays out the content directly (set by VersionService when configured). */
export class SimplePdfRenderer implements PdfRenderer {
  readonly kind = 'simple'
  async htmlToPdf(): Promise<Buffer> { throw new Error('SimplePdfRenderer renders from content, not HTML') }
  async renderContent(c: ResumeContent): Promise<Buffer> { return renderSimplePdf(c) }
  async close(): Promise<void> { /* nothing to close */ }
}
