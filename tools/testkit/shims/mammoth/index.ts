/** Sandbox shim for mammoth: naive DOCX → text via the document.xml inside the zip (no dependency). */
import { inflateRawSync } from 'node:zlib'
export async function extractRawText(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }> {
  const xml = readZipEntry(input.buffer, 'word/document.xml')
  if (!xml) return { value: '', messages: [{ type: 'warning', message: 'document.xml not found' }] }
  const text = xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  return { value: text, messages: [] }
}
function readZipEntry(buf: Buffer, name: string): string | null {
  let off = 0
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8), csize = buf.readUInt32LE(off + 18), nlen = buf.readUInt16LE(off + 26), xlen = buf.readUInt16LE(off + 28)
    const fname = buf.subarray(off + 30, off + 30 + nlen).toString()
    const start = off + 30 + nlen + xlen
    if (fname === name) { const raw = buf.subarray(start, start + csize); return (method === 8 ? inflateRawSync(raw) : raw).toString('utf8') }
    off = start + csize
  }
  return null
}
export async function convertToHtml(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }> {
  const xml = readZipEntry(input.buffer, 'word/document.xml') ?? ''
  const tables = (xml.match(/<w:tbl>/g) ?? []).length
  const images = (xml.match(/<w:drawing>|<pic:pic/g) ?? []).length
  const body = xml.replace(/<\/w:p>/g, '</p>').replace(/<w:p[ >][^>]*>/g, '<p>').replace(/<(?!\/?p>)[^>]+>/g, '')
  return { value: '<table></table>'.repeat(tables) + '<img/>'.repeat(images) + body, messages: [] }
}
export default { extractRawText, convertToHtml }
