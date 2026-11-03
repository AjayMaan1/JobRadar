import { describe, expect, it } from 'vitest'
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import { makePdf, column } from '../../../../tools/testkit/pdf'
import { extractDocument, sniffFormat } from './extract.js'
import { checkParseability, parseabilityPoints } from './parseability.js'
import { extractContacts, skeletonFromText, structureResume } from './structure.js'
import { FakeLlmProvider } from '@jobradar/llm'
import { SAMPLE_RESUME_TEXT } from '../__fixtures__/sample.js'

const LINES = SAMPLE_RESUME_TEXT.split('\n')

/** Word-wrap to a column width (chars) so two-column fixtures don't straddle the gutter. */
function wrap(lines: string[], width: number): string[] {
  const out: string[] = []
  for (const l of lines) {
    let cur = ''
    for (const w of l.split(' ')) {
      if ((cur + ' ' + w).trim().length > width) { out.push(cur.trim()); cur = w } else cur = `${cur} ${w}`
    }
    out.push(cur.trim())
  }
  return out
}

describe('extraction + parseability (PDF)', () => {
  it('single-column resume parses cleanly with no warnings', async () => {
    const pdf = makePdf([{ texts: column(LINES, 60, 740, 13, 9) }])
    expect(sniffFormat(pdf)).toBe('pdf')
    const doc = await extractDocument(pdf)
    expect(doc.pages).toBe(1)
    expect(doc.text).toContain('Built event-driven order pipeline')
    expect(doc.text).toContain('jane.doe@example.com')
    const w = checkParseability(doc)
    expect(w.map((x) => x.code)).toEqual([])
    expect(parseabilityPoints(w)).toBe(15)
  })
  it('two-column layout is detected, reconstructed column-wise, and penalised', async () => {
    const left = wrap(LINES.slice(0, 12), 44), right = wrap(LINES.slice(12), 44)
    const pdf = makePdf([{ texts: [...column(left, 40, 740, 12, 8), ...column(right, 330, 740, 12, 8)] }])
    const doc = await extractDocument(pdf)
    expect(doc.layout![0].columnSplitX).not.toBeNull()
    // column-aware reading order: the left column's lines stay contiguous
    const i1 = doc.text.indexOf('Built event-driven'), i2 = doc.text.indexOf('Mentored 3 junior'), j = doc.text.indexOf('Beta Labs')
    expect(i1).toBeGreaterThan(-1)
    expect(i1).toBeLessThan(i2)
    expect(i2).toBeLessThan(j)
    const codes = checkParseability(doc).map((x) => x.code)
    expect(codes).toContain('multi_column')
  })
  it('table-like rows and image-only pages are flagged', async () => {
    const rows = Array.from({ length: 6 }, (_, r) => [{ x: 60, y: 700 - r * 14, text: `Skill ${r}` }, { x: 260, y: 700 - r * 14, text: 'Expert' }, { x: 460, y: 700 - r * 14, text: '5 yrs' }]).flat()
    const pdf = makePdf([{ texts: [...column(LINES, 60, 760, 11, 8), ...rows.map((t) => ({ ...t, y: t.y - 400 }))] }, { texts: [], images: [{ x: 40, y: 40, w: 500, h: 700 }] }])
    const doc = await extractDocument(pdf)
    const codes = checkParseability(doc).map((x) => x.code)
    expect(codes).toContain('tables')
    expect(codes).toContain('image_only_pages')
  })
  it('scanned (no text) document is a fatal warning', async () => {
    const doc = await extractDocument(makePdf([{ texts: [], images: [{ x: 0, y: 0, w: 600, h: 780 }] }]))
    const w = checkParseability(doc)
    expect(w[0].code).toBe('no_text')
    expect(parseabilityPoints(w)).toBe(0)
  })
})

describe('extraction (DOCX)', () => {
  it('extracts text and counts tables', async () => {
    const doc = new Document({
      sections: [{
        children: [
          ...LINES.map((l) => new Paragraph({ children: [new TextRun(l)] })),
          new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('Go')] }), new TableCell({ children: [new Paragraph('Expert')] })] })] }),
        ],
      }],
    })
    const buf = Buffer.from(await Packer.toBuffer(doc))
    expect(sniffFormat(buf)).toBe('docx')
    const d = await extractDocument(buf)
    expect(d.format).toBe('docx')
    expect(d.text).toContain('Reduced PostgreSQL p99 latency')
    expect(d.docx?.tables).toBe(1)
    expect(checkParseability(d).map((x) => x.code)).toContain('tables')
  })
})

describe('structuring', () => {
  it('falls back to the heuristic parser when the LLM call fails', async () => {
    const llm = new FakeLlmProvider().on('parse_resume', () => { throw new Error('ollama down') })
    const r = await structureResume(SAMPLE_RESUME_TEXT, llm)
    expect(r.llmUsed).toBe(false)
    expect(r.content.work).toHaveLength(2)
  })
  it('masks PII before the LLM and restores it after; contacts backstopped deterministically', async () => {
    const llm = new FakeLlmProvider().on('parse_resume', (req) => {
      expect(req.user).not.toContain('jane.doe@example.com')
      expect(req.user).not.toContain('98765')
      expect(req.user).toContain('[EMAIL_1]')
      return { basics: { name: 'Jane Doe', email: '[EMAIL_1]', summary: 'Backend engineer' }, work: [{ name: 'Acme Payments', position: 'Senior Software Engineer', startDate: '2020-01', highlights: ['Built event-driven order pipeline in Go'] }] }
    })
    const r = await structureResume(SAMPLE_RESUME_TEXT, llm)
    expect(r.llmUsed).toBe(true)
    expect(r.content.basics.email).toBe('jane.doe@example.com')
    expect(r.content.basics.phone).toBe('+91 98765 43210') // model omitted it → deterministic backstop
    expect(r.content.work[0].highlights[0]).toContain('Go')
  })
  it('without an LLM (model not running) the heuristic parser still structures the resume', async () => {
    const r = await structureResume(SAMPLE_RESUME_TEXT, null)
    expect(r.llmUsed).toBe(false)
    expect(r.content.basics.name).toBe('Jane Doe')
    expect(r.content.basics.email).toBe('jane.doe@example.com')
    expect(r.content.basics.label).toBe('Senior Software Engineer')
    expect(r.content.work.map((w) => [w.position, w.name, w.startDate, w.endDate, w.highlights.length])).toEqual([
      ['Senior Software Engineer', 'Acme Payments', '2020-01', '', 3],
      ['Software Engineer', 'Beta Labs', '2017-06', '2019-12', 2],
    ])
    expect(r.content.skills.map((g) => [g.name, g.keywords.length])).toEqual([['Languages', 3], ['Infrastructure', 5]])
    expect(r.content.education[0]).toMatchObject({ institution: 'IIT Delhi', studyType: 'B.Tech', area: 'Computer Science', endDate: '2017' })
    expect(r.content.certificates[0].name).toMatch(/AWS Certified Solutions Architect/)
    expect(r.content.projects[0].highlights).toHaveLength(3)
    expect(skeletonFromText('Bob\nbob@x.io').basics.name).toBe('Bob')
    expect(extractContacts('see linkedin.com/in/jane and https://j.dev').urls).toEqual(['linkedin.com/in/jane', 'https://j.dev'])
  })
})
