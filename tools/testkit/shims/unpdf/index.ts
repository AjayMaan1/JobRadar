/** Sandbox shim for unpdf: backed by the globally installed pdfjs-dist (legacy build, Node-safe). */
type PdfJs = { getDocument: (o: { data: Uint8Array }) => { promise: Promise<unknown> }; OPS: Record<string, number> }
let mod: Promise<PdfJs> | null = null
export async function getResolvedPDFJS(): Promise<PdfJs> {
  if (!mod) mod = import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfJs>
  return mod
}
export async function getDocumentProxy(data: Uint8Array): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const pdfjs = await getResolvedPDFJS()
  const req = (await import('node:module')).createRequire(typeof __filename !== 'undefined' ? __filename : `${process.cwd()}/`)
  const fonts = req.resolve('pdfjs-dist/package.json').replace(/package\.json$/, 'standard_fonts/')
  return (pdfjs.getDocument as (o: Record<string, unknown>) => { promise: Promise<unknown> })({ data, standardFontDataUrl: fonts, verbosity: 0 }).promise
}
export async function extractText(data: Uint8Array, opts?: { mergePages?: boolean }): Promise<{ totalPages: number; text: string | string[] }> {
  const doc = (await getDocumentProxy(data)) as { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }> }> }
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    pages.push(content.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join(''))
  }
  return { totalPages: doc.numPages, text: opts?.mergePages ? pages.join('\n\n') : pages }
}
