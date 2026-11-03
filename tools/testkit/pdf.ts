/**
 * Minimal PDF writer for tests: Helvetica text placed at absolute positions, optional image XObject.
 * Produces valid PDF 1.4 that pdf.js parses (text items keep their x/y so layout heuristics can be tested).
 */
export interface PdfText { x: number; y: number; text: string; size?: number }
export interface PdfPage { texts: PdfText[]; images?: Array<{ x: number; y: number; w: number; h: number }> }

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export function makePdf(pages: PdfPage[], opts: { width?: number; height?: number } = {}): Buffer {
  const W = opts.width ?? 612, H = opts.height ?? 792
  const objects: string[] = []
  const add = (body: string): number => { objects.push(body); return objects.length }

  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  // 1x1 gray image used for every image placement
  const imgId = add('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream')
  const pageIds: number[] = []
  const pagesId = objects.length + pages.length * 2 + 1 // placeholder computed below
  const pageObjs: Array<{ contentId: number; pageBody: (pagesRef: number) => string }> = []
  for (const p of pages) {
    let stream = ''
    for (const t of p.texts) stream += `BT /F1 ${t.size ?? 11} Tf ${t.x.toFixed(1)} ${t.y.toFixed(1)} Td (${esc(t.text)}) Tj ET\n`
    for (const im of p.images ?? []) stream += `q ${im.w} 0 0 ${im.h} ${im.x} ${im.y} cm /Im1 Do Q\n`
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`)
    pageObjs.push({ contentId, pageBody: (pagesRef) => `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontId} 0 R >> /XObject << /Im1 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>` })
  }
  const pagesRef = objects.length + pageObjs.length + 1
  for (const po of pageObjs) pageIds.push(add(po.pageBody(pagesRef)))
  const realPagesId = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  if (realPagesId !== pagesRef) throw new Error('pdf writer: pages ref mismatch')
  const catalogId = add(`<< /Type /Catalog /Pages ${realPagesId} 0 R >>`)
  void pagesId

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** Lay paragraphs out top-down in one column starting at (x, top). Returns texts. */
export function column(lines: string[], x: number, top: number, lineHeight = 14, size = 11): PdfText[] {
  return lines.map((text, i) => ({ x, y: top - i * lineHeight, text, size }))
}
