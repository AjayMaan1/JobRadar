import { getDocumentProxy, getResolvedPDFJS } from 'unpdf'
import mammoth from 'mammoth'

export type DocFormat = 'pdf' | 'docx' | 'txt'

export interface TextItem {
  str: string
  x: number
  y: number
  w: number
  h: number
}

export interface PageLayout {
  width: number
  height: number
  items: TextItem[]
  imageCount: number
  /** Column split (x) detected on this page, if any. */
  columnSplitX: number | null
  /** Lines reconstructed in reading order (column-aware). */
  lines: string[]
  /** Count of "table-like" rows: ≥3 items on one baseline separated by wide gaps. */
  tableLikeRows: number
}

export interface ExtractedDoc {
  format: DocFormat
  text: string
  pages: number
  /** PDF only. */
  layout?: PageLayout[]
  /** DOCX only. */
  docx?: { tables: number; images: number }
  /** Characters in the Unicode private-use area (icon fonts → unreadable by ATS). */
  privateUseChars: number
}

export const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
} as const

/** Sniff the real type from magic bytes — never trust the client-supplied MIME. */
export function sniffFormat(buf: Buffer): DocFormat | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  // DOCX is a zip: PK\x03\x04 — confirm [Content_Types].xml / word/ appears early
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('latin1')
    if (head.includes('[Content_Types].xml') || head.includes('word/')) return 'docx'
    return null
  }
  // plain text: no NULs in the first 1KB and mostly printable
  const sample = buf.subarray(0, Math.min(buf.length, 1024))
  if (sample.length && !sample.includes(0)) return 'txt'
  return null
}

function countPrivateUse(text: string): number {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if ((c >= 0xe000 && c <= 0xf8ff) || (c >= 0xf0000 && c <= 0xffffd)) n++
  }
  return n
}

export async function extractDocument(buf: Buffer, format?: DocFormat): Promise<ExtractedDoc> {
  const fmt = format ?? sniffFormat(buf)
  if (!fmt) throw new Error('Unsupported file type (expected PDF or DOCX)')
  if (fmt === 'pdf') return extractPdf(buf)
  if (fmt === 'docx') return extractDocx(buf)
  const text = buf.toString('utf8')
  return { format: 'txt', text, pages: 1, privateUseChars: countPrivateUse(text) }
}

// ── PDF ────────────────────────────────────────────────────────────────────────────────────────────

async function extractPdf(buf: Buffer): Promise<ExtractedDoc> {
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const pdfjs = await getResolvedPDFJS()
  const OPS = (pdfjs as unknown as { OPS: Record<string, number> }).OPS
  const imageOps = new Set([OPS?.paintImageXObject, OPS?.paintJpegXObject, OPS?.paintImageXObjectRepeat, OPS?.paintInlineImageXObject].filter((x) => typeof x === 'number'))

  const layout: PageLayout[] = []
  const pageTexts: string[] = []
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items: TextItem[] = []
      for (const it of content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
        if (!it.str || !it.transform) continue
        const s = it.str.replace(/\s+/g, ' ')
        if (!s.trim()) continue
        items.push({ str: s, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, h: it.height ?? Math.abs(it.transform[3]) ?? 10 })
      }
      let imageCount = 0
      try {
        const ops = await page.getOperatorList()
        for (const fn of ops.fnArray) if (imageOps.has(fn)) imageCount++
      } catch { /* operator list can fail on odd PDFs; images then go unreported */ }

      const pl = buildPageLayout(items, vp.width, vp.height, imageCount)
      layout.push(pl)
      pageTexts.push(pl.lines.join('\n'))
    }
  } finally {
    await pdf.destroy().catch(() => undefined)
  }
  const text = pageTexts.join('\n\n')
  return { format: 'pdf', text, pages: pdf.numPages, layout, privateUseChars: countPrivateUse(text) }
}

interface Line { y: number; items: TextItem[] }

function groupLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Line[] = []
  for (const it of sorted) {
    const tol = Math.max(2, it.h * 0.5)
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tol)
    if (line) line.items.push(it)
    else lines.push({ y: it.y, items: [it] })
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x)
  return lines
}

function lineText(items: TextItem[]): string {
  let out = ''
  let prevEnd: number | null = null
  for (const it of items) {
    if (prevEnd !== null) {
      const gap = it.x - prevEnd
      out += gap > it.h * 1.5 ? '   ' : gap > 0.5 ? ' ' : ''
    }
    out += it.str
    prevEnd = it.x + it.w
  }
  return out.replace(/[ \t]+/g, ' ').trim()
}

/**
 * Column detection: a vertical gap between 30–70% of the page width that almost no item straddles, with a
 * meaningful share of items on both sides. Two-column resumes are reconstructed column-wise for our own
 * parse (and flagged, because most ATS parsers read them interleaved).
 */
function detectColumnSplit(items: TextItem[], width: number): number | null {
  if (items.length < 20) return null
  const step = width / 50
  const valid: number[] = []
  for (let x = width * 0.3; x <= width * 0.7; x += step) {
    let left = 0, right = 0, straddle = 0
    for (const it of items) {
      const x0 = it.x, x1 = it.x + it.w
      if (x1 <= x) left++
      else if (x0 >= x) right++
      else straddle++
    }
    const minSide = items.length * 0.2
    if (left >= minSide && right >= minSide && straddle <= items.length * 0.03) valid.push(x)
  }
  if (!valid.length) return null
  // centre of the widest empty gutter
  let bestStart = 0, bestLen = 1, start = 0
  for (let i = 1; i <= valid.length; i++) {
    if (i === valid.length || valid[i] - valid[i - 1] > step * 1.5) {
      if (i - start > bestLen) { bestLen = i - start; bestStart = start }
      start = i
    }
  }
  return (valid[bestStart] + valid[bestStart + bestLen - 1]) / 2
}

function buildPageLayout(items: TextItem[], width: number, height: number, imageCount: number): PageLayout {
  const columnSplitX = detectColumnSplit(items, width)
  let lines: string[]
  if (columnSplitX !== null) {
    const left = items.filter((i) => i.x + i.w <= columnSplitX)
    const right = items.filter((i) => i.x >= columnSplitX)
    lines = [...groupLines(left).map((l) => lineText(l.items)), '', ...groupLines(right).map((l) => lineText(l.items))]
  } else {
    lines = groupLines(items).map((l) => lineText(l.items))
  }
  // table-like rows: 3+ items on one baseline with wide gaps between them (not just word spacing)
  let tableLikeRows = 0
  for (const l of groupLines(items)) {
    if (l.items.length < 3) continue
    let wideGaps = 0
    for (let i = 1; i < l.items.length; i++) {
      const gap = l.items[i].x - (l.items[i - 1].x + l.items[i - 1].w)
      if (gap > Math.max(18, l.items[i].h * 2)) wideGaps++
    }
    if (wideGaps >= 2) tableLikeRows++
  }
  return { width, height, items, imageCount, columnSplitX, lines: lines.filter((s, i, a) => s || (i > 0 && a[i - 1])), tableLikeRows }
}

// ── DOCX ───────────────────────────────────────────────────────────────────────────────────────────

async function extractDocx(buf: Buffer): Promise<ExtractedDoc> {
  const [raw, html] = await Promise.all([mammoth.extractRawText({ buffer: buf }), mammoth.convertToHtml({ buffer: buf })])
  const tables = (html.value.match(/<table\b/gi) ?? []).length
  const images = (html.value.match(/<img\b/gi) ?? []).length
  const text = raw.value.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  // No page geometry in DOCX; estimate pages from words (≈ 450 words/page for resumes).
  const words = text.split(/\s+/).filter(Boolean).length
  return { format: 'docx', text, pages: Math.max(1, Math.ceil(words / 450)), docx: { tables, images }, privateUseChars: countPrivateUse(text) }
}
