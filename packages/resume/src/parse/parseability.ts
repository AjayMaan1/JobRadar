import type { ExtractedDoc } from './extract.js'

export type WarningSeverity = 'info' | 'warn' | 'error'

export interface ParseWarning {
  code:
    | 'no_text'
    | 'image_only_pages'
    | 'multi_column'
    | 'tables'
    | 'contact_missing_email'
    | 'contact_missing_phone'
    | 'nonstandard_headings'
    | 'too_long'
    | 'too_short'
    | 'icon_fonts'
    | 'many_images'
  severity: WarningSeverity
  message: string
  /** Points deducted from the 15-pt parseability component (ats-v1). */
  penalty: number
}

export const STANDARD_HEADINGS: Record<string, RegExp> = {
  experience: /^\s*(work|professional|employment)?\s*(experience|history)\b|^\s*employment\b/im,
  education: /^\s*education\b|^\s*academic/im,
  skills: /^\s*(technical\s+|core\s+|key\s+)?skills\b|^\s*technologies\b|^\s*tech(nical)? stack\b/im,
  summary: /^\s*(professional\s+)?(summary|profile|about( me)?|objective)\b/im,
}

export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
export const PHONE_RE = /(?:\+?\d[\d\s().-]{7,16}\d)/

/**
 * "If we can't parse it, an ATS can't either." Deterministic checks on the extracted document; the
 * penalties feed the parseability component of ats-v1 and the messages go to the user as-is.
 */
export function checkParseability(doc: ExtractedDoc): ParseWarning[] {
  const w: ParseWarning[] = []
  const text = doc.text ?? ''
  const words = text.split(/\s+/).filter(Boolean).length

  if (words < 30) {
    w.push({ code: 'no_text', severity: 'error', penalty: 15, message: 'No machine-readable text found. The file is probably a scanned image or uses outlined fonts; ATS systems will see an empty resume.' })
    return w
  }

  if (doc.layout) {
    const imageOnly = doc.layout.filter((p) => p.imageCount > 0 && p.items.map((i) => i.str).join('').trim().length < 40).length
    if (imageOnly) w.push({ code: 'image_only_pages', severity: 'error', penalty: 6, message: `${imageOnly} page(s) contain only images — their content is invisible to ATS parsers.` })

    const cols = doc.layout.filter((p) => p.columnSplitX !== null).length
    if (cols) w.push({ code: 'multi_column', severity: 'warn', penalty: 4, message: `Two-column layout detected on ${cols} page(s). Many ATS parsers read columns interleaved, scrambling your experience. Prefer a single column.` })

    const tableRows = doc.layout.reduce((a, p) => a + p.tableLikeRows, 0)
    if (tableRows >= 4) w.push({ code: 'tables', severity: 'warn', penalty: 3, message: 'Table-like layout detected (aligned cells). Tables often lose their structure in ATS parsing; use plain lines and bullets.' })

    const images = doc.layout.reduce((a, p) => a + p.imageCount, 0)
    if (images >= 3) w.push({ code: 'many_images', severity: 'info', penalty: 1, message: `${images} images found. Icons and graphics are ignored by ATS; make sure nothing important is only shown as an image.` })
  }
  if (doc.docx) {
    if (doc.docx.tables > 0) w.push({ code: 'tables', severity: 'warn', penalty: 3, message: `${doc.docx.tables} table(s) in the document. Tables often lose their structure in ATS parsing; use plain lines and bullets.` })
    if (doc.docx.images >= 3) w.push({ code: 'many_images', severity: 'info', penalty: 1, message: `${doc.docx.images} images found. Icons and graphics are ignored by ATS.` })
  }

  if (doc.privateUseChars > 3) w.push({ code: 'icon_fonts', severity: 'warn', penalty: 2, message: 'Icon-font characters detected (e.g. phone/email icons). They appear as garbage to parsers; use plain text labels.' })

  if (!EMAIL_RE.test(text)) w.push({ code: 'contact_missing_email', severity: 'error', penalty: 4, message: 'No email address found in the text. If it is in a header/footer or an image, ATS parsers will miss it.' })
  if (!PHONE_RE.test(text)) w.push({ code: 'contact_missing_phone', severity: 'warn', penalty: 2, message: 'No phone number found in the text.' })

  const present = Object.entries(STANDARD_HEADINGS).filter(([, re]) => re.test(text)).map(([k]) => k)
  if (!present.includes('experience') || !present.includes('skills')) {
    const missing = ['experience', 'skills', 'education'].filter((k) => !present.includes(k))
    w.push({ code: 'nonstandard_headings', severity: 'warn', penalty: 3, message: `Standard section headings not found: ${missing.join(', ')}. Parsers map content by heading names — use "Experience", "Skills", "Education".` })
  }

  if (doc.pages > 2) w.push({ code: 'too_long', severity: 'info', penalty: 2, message: `${doc.pages} pages. Two pages is the practical maximum for most roles.` })
  if (words < 150) w.push({ code: 'too_short', severity: 'warn', penalty: 2, message: `Only ${words} words — too little content for keyword matching.` })

  return w
}

/** 0..15 parseability points (ats-v1 component) from the warnings. */
export function parseabilityPoints(warnings: Pick<ParseWarning, 'penalty'>[]): number {
  return Math.max(0, 15 - warnings.reduce((a, w) => a + w.penalty, 0))
}
