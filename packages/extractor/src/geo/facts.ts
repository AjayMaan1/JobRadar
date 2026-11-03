import { COUNTRIES, COUNTRY_RE, METRO_RE, REGIONS, REGION_ALIASES, TZ_TOKENS, countryDef, type MetroDef } from './dictionary.js'
import { annualize, toUSD } from '../currency-converter.js'

/**
 * Global, user-independent job facts (HLD dynamic preferences §4). Replaces the India-specific yes/no of the
 * legacy classifier with structure the per-user evaluator can reason about:
 *
 *   geo.allow     explicit "you may apply from" tokens (WORLDWIDE, APAC, IN …) — non-exclusive signals
 *   geo.restrict  "only from" tokens from restriction phrases ("US only", "must be based in Germany") — exclusive
 *   geo.tzWindow  required/acceptable UTC offset range ("4h overlap with CET", "UTC+5:30 preferred")
 *   geo.eorOk     hires anywhere via an employer of record / contractor setup
 *
 * The evaluator decides eligibility for a given home country + timezone (see @jobradar/prefs evaluate()).
 */
export const FACTS_VERSION = 'facts-v1'

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown'

export interface JobLocation { raw: string; country?: string; metro?: string; region?: string; remote?: boolean }

export interface GeoFacts {
  allow: string[]
  allowStrength: 'strong' | 'weak' | 'none'
  restrict: string[]
  restrictSource: 'location' | 'body' | null
  tzWindow: { minUtc: number; maxUtc: number } | null
  tzSource: 'only' | 'overlap' | 'preferred' | null
  eorOk: boolean
  evidence: string[]
}

export interface JobFacts {
  version: string
  workMode: WorkMode
  locations: JobLocation[]
  geo: GeoFacts
  employmentType: 'full_time' | 'contract' | 'part_time' | 'internship' | 'unknown'
  seniority: string | null
  category: string | null
  skills: string[]
  salary: { min: number; max: number; currency: string; period: string; usdMin: number; usdMax: number } | null
  company: { hqCountry: string | null; tags: string[] }
}

export interface FactsInput {
  title: string
  location: string | null | undefined
  description: string
  remoteType: WorkMode
  isRemoteFlag?: boolean | null
  tags?: string[]
  employmentType: JobFacts['employmentType']
  seniority?: string | null
  category?: string | null
  skills?: string[]
  salary?: { min: number; max: number; currency: string; period: 'year' | 'month' | 'hour' } | null
  company?: { hqCountry?: string | null; tags?: string[] } | null
}

// ── phrase vocabulary (generalised from the legacy India-only patterns) ──────────────────────────────────────
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Aliases usable inside restriction phrases: ≥3 chars, plus the unambiguous short ones.
const SHORT_OK = new Set(['us', 'uk', 'eu', 'nz', 'uae', 'ksa'])
const PLACE_ALT = [
  ...COUNTRIES.flatMap((c) => c.aliases.filter((a) => a.length >= 3 || SHORT_OK.has(a))),
  'apac', 'asia pacific', 'emea', 'eu', 'european union', 'europe', 'latam', 'latin america', 'north america', 'americas', 'middle east', 'mena', 'nordics', 'dach', 'benelux', 'cee',
].sort((a, b) => b.length - a.length).map(esc).join('|')
const PLACE = `(?:the )?(${PLACE_ALT})`
const PLACE_LIST = `${PLACE}((?:,\\s*|\\s+(?:and|or|&)\\s+|\\s*/\\s*)${PLACE})*`

const RESTRICTION_RES: Array<{ re: RegExp; kind: 'place' | 'tz' }> = [
  { re: new RegExp(`\\b${PLACE_LIST}[ -]?(only|based|residents?|citizens?)\\b`, 'i'), kind: 'place' },
  { re: new RegExp(`\\bremote\\s*[-–—(:]\\s*${PLACE_LIST}\\b`, 'i'), kind: 'place' },
  { re: new RegExp(`\\b(must|need to|required to|should) (be )?(based|located|reside|residing|living|live) (in|within) ${PLACE_LIST}\\b`, 'i'), kind: 'place' },
  { re: new RegExp(`\\b(right|eligible|eligibility|authori[sz]ed|authori[sz]ation|legally able|permit) to work in ${PLACE_LIST}\\b`, 'i'), kind: 'place' },
  { re: /\b(us|u\.s\.) work authori[sz]ation\b/i, kind: 'place' },
  { re: new RegExp(`\\bno (visa )?sponsorship\\b[^.]{0,80}\\b${PLACE}\\b`, 'i'), kind: 'place' },
  { re: new RegExp(`\\bcandidates? (must|should) be (in|from) ${PLACE_LIST}\\b`, 'i'), kind: 'place' },
  { re: new RegExp(`\\b(we (are )?(only|currently) (able to )?hir(e|ing)|open to candidates|hiring only) (in|from) ${PLACE_LIST}\\b`, 'i'), kind: 'place' },
  { re: /\b(within|in) (the )?(us|eu|uk|canadian|pacific|eastern|central|mountain|cet|cest|gmt|bst|pst|est|pt|et|ist) (time ?zones?|hours)\s*(only|required)\b/i, kind: 'tz' },
]

const STRONG_ALLOW_RE = /\b(worldwide|world-wide|work from anywhere|anywhere in the world|anywhere|global(ly)? remote|globally distributed|open to all countries|international candidates?|all time ?zones?|any time ?zone)\b/i
const WEAK_ALLOW_RE = /\b(fully remote|remote[- ]first|100% remote|distributed team)\b/i
const EOR_RE = [
  /\b(hire|hiring|employ)\w*\s+(via|through|with)\s+(deel|remote\.com|oyster|papaya|rippling|velocity global|multiplier|an? (eor|employer of record))\b/i,
  /\b(contractor|contract)\b.{0,60}\b(any|all) (country|countries|location)s?\b/i,
  /\bindependent contractor\b/i,
]
const OVERLAP_RE = /\boverlap\b.{0,40}\b(ist|cet|cest|gmt|utc|bst|est|pst|uk|europe|apac|asia|india|us)\b/i
const UTC_OFFSET_RE = /\b(utc|gmt)\s*([+-])\s*(\d{1,2})(?::(\d{2}))?\b/i

function tzOf(token: string): number | null {
  for (const [re, off] of TZ_TOKENS) if (re.test(token)) return off
  const c = COUNTRIES.find((x) => x.aliases.includes(token.toLowerCase()))
  if (c) return c.tz
  if (/^(europe|eu|emea)$/i.test(token)) return 1
  if (/^(apac|asia)$/i.test(token)) return 7
  if (/^india$/i.test(token)) return 5.5
  return null
}

/** Tokens (country codes / region tokens) mentioned in a phrase. */
function placeTokens(phrase: string): string[] {
  const out: string[] = []
  for (const [re, tok] of REGION_ALIASES) if (tok !== 'WORLDWIDE' && re.test(phrase)) out.push(tok)
  for (const [re, code] of COUNTRY_RE) if (re.test(phrase)) out.push(code)
  return [...new Set(out)]
}

// ── location line ───────────────────────────────────────────────────────────────────────────────────────────
export function parseLocations(location: string | null | undefined): JobLocation[] {
  if (!location) return []
  const parts = location.split(/\s*[;|•·]\s*|\s+\/\s+|\s+or\s+|\s*\(\s*|\s*\)\s*|\s+[-–—]\s+/).map((s) => s.trim()).filter(Boolean)
  const out: JobLocation[] = []
  for (const raw of parts.length ? parts : [location]) {
    const loc: JobLocation = { raw }
    if (/\bremote\b/i.test(raw)) loc.remote = true
    for (const [re, m] of METRO_RE) if (re.test(raw)) { loc.metro = (m as MetroDef).id; loc.country = (m as MetroDef).country; break }
    if (!loc.country) for (const [re, code] of COUNTRY_RE) if (re.test(raw)) { loc.country = code; break }
    for (const [re, tok] of REGION_ALIASES) if (re.test(raw)) { loc.region = tok; break }
    // "IST" in a location line is a country hint, not a timezone restriction
    if (!loc.country && /\bist\b/i.test(raw)) loc.country = 'IN'
    out.push(loc)
  }
  return out
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────
export function extractJobFacts(input: FactsInput): JobFacts {
  const location = (input.location ?? '').trim()
  const desc = (input.description ?? '').slice(0, 4000)
  const tags = (input.tags ?? []).join(' ').toLowerCase()
  const text = `${location}\n${desc}`

  const locSaysRemote = /\bremote\b/i.test(location) || /\bremote\b/.test(tags)
  const locSaysHybrid = /\bhybrid\b/i.test(location) || /\bhybrid\b/.test(tags)
  let workMode: WorkMode = input.remoteType
  if (locSaysHybrid || input.remoteType === 'hybrid') workMode = 'hybrid'
  else if (input.remoteType === 'remote' || input.isRemoteFlag === true || locSaysRemote) workMode = 'remote'
  else if (input.remoteType === 'onsite') workMode = 'onsite'

  const locations = parseLocations(location)
  const geo: GeoFacts = { allow: [], allowStrength: 'none', restrict: [], restrictSource: null, tzWindow: null, tzSource: null, eorOk: false, evidence: [] }

  // Restrictions: the location line is authoritative over the body (legacy rule preserved).
  for (const source of ['location', 'body'] as const) {
    const hay = source === 'location' ? location : desc
    for (const { re, kind } of RESTRICTION_RES) {
      const m = hay.match(re)
      if (!m) continue
      if (kind === 'tz') {
        const off = tzOf(m[3])
        if (off !== null && !geo.tzWindow) { geo.tzWindow = { minUtc: off - 3, maxUtc: off + 3 }; geo.tzSource = 'only'; geo.evidence.push(m[0]) }
        continue
      }
      const toks = /work authori/i.test(m[0]) ? ['US'] : placeTokens(m[0])
      if (!toks.length) continue
      if (!geo.restrict.length) geo.restrictSource = source
      if (geo.restrictSource === source) for (const t of toks) if (!geo.restrict.includes(t)) geo.restrict.push(t)
      geo.evidence.push(m[0])
    }
    if (geo.restrict.length && source === 'location') break
  }

  // Allow signals
  const strong = text.match(STRONG_ALLOW_RE)
  const weak = text.match(WEAK_ALLOW_RE)
  if (strong) { geo.allow.push('WORLDWIDE'); geo.allowStrength = 'strong'; geo.evidence.push(strong[0]) }
  else if (weak) { geo.allow.push('WORLDWIDE'); geo.allowStrength = 'weak'; geo.evidence.push(weak[0]) }
  // Note: a bare city/country in the location line of a remote posting (Lever/Ashby list the office) is a
  // hint (locations[]), not a restriction — only "Remote - X" / "X only" phrasing restricts (legacy rule kept).
  if (workMode === 'remote') {
    for (const [re, tok] of REGION_ALIASES) if (tok !== 'WORLDWIDE' && re.test(desc) && !geo.allow.includes(tok) && /\b(remote|hiring|candidates|across|anywhere in|based in)\b[^.]{0,40}/i.test(desc)) {
      // region mentioned as an allowed area in the body ("remote across EMEA") — advisory, non-exclusive
      if (new RegExp(`\\b(remote|hiring|candidates|across|throughout|anywhere in)\\b[^.]{0,30}\\b${REGIONS[tok] ? tok.toLowerCase().replace('_', ' ') : tok}`, 'i').test(desc)) geo.allow.push(tok)
    }
  }
  // Timezone windows
  const overlap = text.match(OVERLAP_RE)
  if (overlap && !geo.tzWindow) {
    const off = tzOf(overlap[1])
    if (off !== null) { geo.tzWindow = { minUtc: off - 6, maxUtc: off + 6 }; geo.tzSource = 'overlap'; geo.evidence.push(overlap[0]) }
  }
  const utc = text.match(UTC_OFFSET_RE)
  if (utc && !geo.tzWindow) {
    const off = (utc[2] === '-' ? -1 : 1) * (parseInt(utc[3], 10) + (utc[4] ? parseInt(utc[4], 10) / 60 : 0))
    geo.tzWindow = { minUtc: off - 3, maxUtc: off + 3 }
    geo.tzSource = 'preferred'
    geo.evidence.push(utc[0])
  }
  // EOR / contractor anywhere
  for (const re of EOR_RE) { const m = text.match(re); if (m) { geo.eorOk = true; geo.evidence.push(m[0]); break } }

  const salary = input.salary
    ? { min: annualize(input.salary.min, input.salary.period), max: annualize(input.salary.max, input.salary.period), currency: input.salary.currency.toUpperCase(), period: input.salary.period, usdMin: toUSD(annualize(input.salary.min, input.salary.period), input.salary.currency), usdMax: toUSD(annualize(input.salary.max, input.salary.period), input.salary.currency) }
    : null

  return {
    version: FACTS_VERSION,
    workMode,
    locations,
    geo: { ...geo, evidence: [...new Set(geo.evidence)].slice(0, 8) },
    employmentType: input.employmentType,
    seniority: input.seniority ?? null,
    category: input.category ?? null,
    skills: input.skills ?? [],
    salary,
    company: { hqCountry: input.company?.hqCountry?.toUpperCase() ?? null, tags: (input.company?.tags ?? []).map((t) => t.toLowerCase()) },
  }
}

/**
 * Is a candidate living in `country` (UTC offset `tz`) eligible for this posting, given its facts?
 * Pure; mirrors the legacy classifier's precedence (location-line restriction wins, an explicit worldwide
 * signal beats a body restriction, no phrases at all = eligible with no confidence).
 */
export function eligibleFor(facts: Pick<JobFacts, 'geo'>, country: string, tz?: number | null): { eligible: boolean; confidence: 'strong' | 'weak' | 'none'; reason: string } {
  const g = facts.geo
  const cc = country.toUpperCase()
  const userTz = tz ?? countryDef(cc)?.tz ?? null
  const inWindow = !g.tzWindow || userTz === null || (userTz >= g.tzWindow.minUtc && userTz <= g.tzWindow.maxUtc)
  const covers = (toks: string[]) => toks.some((t) => t.toUpperCase() === 'WORLDWIDE') || [...toks].some((t) => (REGIONS[t.toUpperCase()] ?? [t.toUpperCase()]).includes(cc))

  if (g.restrict.length && covers(g.restrict)) return { eligible: true, confidence: 'strong', reason: `hires in ${g.restrict.join('/')}` }
  if (g.restrict.length && g.restrictSource === 'location') return { eligible: false, confidence: 'strong', reason: `restricted (location): ${g.restrict.join('/')}` }
  if (g.eorOk) return { eligible: true, confidence: 'strong', reason: 'hires via EOR / contractor anywhere' }
  if (g.restrict.length) {
    if (g.allowStrength === 'strong') return { eligible: true, confidence: 'weak', reason: `${g.allow.join('/')} (despite: ${g.restrict.join('/')})` }
    return { eligible: false, confidence: 'strong', reason: `restricted: ${g.restrict.join('/')}` }
  }
  if (g.allow.length && covers(g.allow)) return { eligible: inWindow, confidence: g.allowStrength === 'strong' ? 'strong' : 'weak', reason: inWindow ? `open: ${g.allow.join('/')}` : `timezone window ${fmtTz(g.tzWindow!)}` }
  if (g.allow.length) return { eligible: false, confidence: 'strong', reason: `hires in ${g.allow.join('/')}` }
  if (g.tzWindow) return inWindow ? { eligible: true, confidence: 'weak', reason: `within timezone window ${fmtTz(g.tzWindow)}` } : { eligible: false, confidence: g.tzSource === 'only' ? 'strong' : 'weak', reason: `outside timezone window ${fmtTz(g.tzWindow)}` }
  return { eligible: true, confidence: 'none', reason: 'no restriction phrase found' }
}

function fmtTz(w: { minUtc: number; maxUtc: number }): string {
  const f = (n: number) => `UTC${n >= 0 ? '+' : ''}${n}`
  return `${f(w.minUtc)}…${f(w.maxUtc)}`
}
