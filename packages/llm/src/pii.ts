/**
 * Reversible PII masking for LLM calls (HLD V7). Emails, phones, URLs and (when known) the person's name are
 * replaced with stable placeholders; the map is kept only in memory / the job payload and used to restore
 * the values afterwards. The model never needs contact details to structure or tailor a resume.
 */
export interface PiiMap {
  [placeholder: string]: string
}

export interface MaskResult {
  masked: string
  map: PiiMap
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
// International-ish phone numbers: optional +, 8–15 digits with separators. Avoids matching years/dates.
const PHONE = /(?<![\w/.-])(?:\+?\d[\d\s().-]{7,16}\d)(?![\w/.-])/g
const URL = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function maskPii(text: string, opts: { names?: string[] } = {}): MaskResult {
  const map: PiiMap = {}
  const reverse = new Map<string, string>()
  const counters: Record<string, number> = {}
  const token = (kind: string, value: string): string => {
    const hit = reverse.get(`${kind}:${value}`)
    if (hit) return hit
    counters[kind] = (counters[kind] ?? 0) + 1
    const ph = `[${kind}_${counters[kind]}]`
    map[ph] = value
    reverse.set(`${kind}:${value}`, ph)
    return ph
  }

  let out = text.replace(EMAIL, (m) => token('EMAIL', m))
  out = out.replace(URL, (m) => token('URL', m))
  out = out.replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, '')
    // 9+ digits, or 8+ with an explicit "+" prefix. Avoids year ranges like "2019-2023" (8 digits);
    // 8-digit local numbers without a country code are the accepted trade-off.
    if (digits.length > 15 || digits.length < 8 || (digits.length === 8 && !m.trim().startsWith('+'))) return m
    return token('PHONE', m)
  })
  for (const name of (opts.names ?? []).filter((n) => n && n.trim().length >= 3)) {
    out = out.replace(new RegExp(`\\b${escapeRe(name.trim())}\\b`, 'g'), (m) => token('NAME', m))
  }
  return { masked: out, map }
}

export function unmaskPii(text: string, map: PiiMap): string {
  let out = text
  for (const [ph, value] of Object.entries(map)) out = out.split(ph).join(value)
  return out
}

/** Walk any JSON value and unmask every string. */
export function unmaskDeep<T>(value: T, map: PiiMap): T {
  if (typeof value === 'string') return unmaskPii(value, map) as unknown as T
  if (Array.isArray(value)) return value.map((v) => unmaskDeep(v, map)) as unknown as T
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) o[k] = unmaskDeep(v, map)
    return o as T
  }
  return value
}
