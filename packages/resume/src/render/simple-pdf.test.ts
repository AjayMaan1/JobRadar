import { describe, expect, it } from 'vitest'
import { renderSimplePdf } from './simple-pdf.js'
import { extractDocument } from '../parse/extract.js'
import { checkParseability } from '../parse/parseability.js'
import { heuristicParse } from '../parse/heuristic.js'
import { SAMPLE_RESUME } from '../__fixtures__/sample.js'

describe('simple PDF renderer (no Chromium)', () => {
  it('produces a valid single-column PDF that round-trips through our own parser', async () => {
    const pdf = renderSimplePdf(SAMPLE_RESUME)
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const doc = await extractDocument(pdf, 'pdf')
    expect(doc.pages).toBe(1)
    const codes = checkParseability(doc).map((w) => w.code)
    expect(codes).not.toContain('multi_column')
    expect(codes).not.toContain('contact_missing_email')
    const back = heuristicParse(doc.text)
    expect(back.work.map((w) => `${w.position} @ ${w.name}`)).toEqual(['Senior Software Engineer @ Acme Payments', 'Software Engineer @ Beta Labs'])
    expect(back.work[0].highlights).toHaveLength(3)
    expect(back.skills.reduce((a, g) => a + g.keywords.length, 0)).toBe(8)
  })
  it('handles non-WinAnsi characters without breaking the file', async () => {
    const pdf = renderSimplePdf({ ...SAMPLE_RESUME, basics: { ...SAMPLE_RESUME.basics, summary: 'Saved ₹12L/yr → 40% faster ✓ “quoted” — naïve café 日本語' } })
    const doc = await extractDocument(pdf, 'pdf')
    expect(doc.text).toContain('Rs 12L/yr')
    expect(doc.text).toContain('40% faster')
  })
})
