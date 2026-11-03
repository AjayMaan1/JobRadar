import { findSkills } from '../skills/aliases.js'
import { JD_EXTRACTOR_VERSION, type JobRequirementsData, type RequirementItem, type Seniority } from './types.js'

export type Bucket = 'required' | 'preferred' | 'responsibilities' | 'intro' | 'other'

const HEADINGS: Array<[Bucket, RegExp]> = [
  ['preferred', /\b(nice[- ]to[- ]haves?|bonus( points)?|preferred( qualifications| skills| experience)?|good[- ]to[- ]have|extra credit|desirable|a plus|would be great|additional qualifications)\b/i],
  ['required', /\b(requirements?|qualifications?|what you('|’)?ll bring|what you bring|what you('|’)?ll need|what you need|must[- ]haves?|you have|what we('|’)?re looking for|what we are looking for|who you are|about you|required skills|minimum qualifications|basic qualifications|your profile|skills (and|&) experience|experience (and|&) skills|what it takes|ideal candidate|you should have|we expect|your experience|your skills|key skills|technical skills|skills required)\b/i],
  ['responsibilities', /\b(responsibilities|what you('|’)?ll do|what you will do|what you('|’)?ll be doing|the role|your role|you will|day[- ]to[- ]day|in this role|your mission|what you('|’)?ll own|key duties|duties|your impact|the opportunity|about the role|role overview|job description)\b/i],
  ['other', /\b(about (us|the company|the team|our team|[A-Z][\w]+)|benefits|perks|why (join|us|work)|compensation|salary|interview process|equal opportunity|we offer|what we offer|our (stack|culture|values)|how we work|the team|location|hiring process|diversity)\b/i],
]

const SENIORITY: Array<[RegExp, Seniority]> = [
  [/\b(staff|principal|distinguished|architect)\b/i, 'staff'],
  [/\b(engineering manager|manager|director|head of|vp)\b/i, 'manager'],
  [/\b(lead|tech lead)\b/i, 'lead'],
  [/\b(senior|sr\.?)\b/i, 'senior'],
  [/\b(junior|jr\.?|entry[- ]level|graduate|intern)\b/i, 'junior'],
  [/\b(mid[- ]level|intermediate)\b/i, 'mid'],
]

export function isHeadingLine(line: string): Bucket | null {
  const t = line.trim()
  if (!t || t.length > 70) return null
  if (/^[-*•▪◦]\s/.test(t)) return null // bullet lines are content, never headings
  if (/[.!?]$/.test(t)) return null
  const stripped = t.replace(/^#+\s*/, '').replace(/:$/, '')
  const words = stripped.split(/\s+/).length
  if (words > 6 && !/:$/.test(t)) return null
  for (const [bucket, re] of HEADINGS) if (re.test(stripped)) return bucket
  return null
}

export interface SectionedJd {
  buckets: Record<Bucket, string[]>
  headingsFound: number
}

/** Split a (structure-preserved) description into requirement buckets by heading lines. */
export function sectionize(description: string): SectionedJd {
  const buckets: Record<Bucket, string[]> = { required: [], preferred: [], responsibilities: [], intro: [], other: [] }
  let current: Bucket = 'intro'
  let headingsFound = 0
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const h = isHeadingLine(line)
    if (h) { current = h; headingsFound++; continue }
    // inline cues on bullet lines
    let target: Bucket = current
    if (current !== 'other' && /\b(nice[- ]to[- ]have|bonus|preferred|a plus|plus:|good to have|not required)\b/i.test(line)) target = 'preferred'
    buckets[target].push(line)
  }
  return { buckets, headingsFound }
}

export function detectSeniority(title: string, text = ''): Seniority | null {
  for (const [re, s] of SENIORITY) if (re.test(title)) return s
  for (const [re, s] of SENIORITY) if (s !== 'manager' && re.test(text.slice(0, 400))) return s
  return null
}

/** "Senior Backend Engineer (Remote - EMEA)" → "backend engineer" */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(sr|jr)\.(?=\s|$)/g, ' ')
    .replace(/\b(remote|hybrid|onsite|on-site|contract|full[- ]time|part[- ]time|urgent|hiring|immediate|wfh|india|us|usa|uk|emea|apac|europe|worldwide)\b/g, ' ')
    .replace(/\b(senior|sr|junior|jr|staff|principal|lead|mid[- ]level|intermediate|entry[- ]level|associate|i{1,3}|iv|v)\b/g, ' ')
    .replace(/[^a-z0-9+#./ -]+/g, ' ')
    .replace(/\s-\s|^-|-$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const YEARS_RE = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*\+?)?\s*(?:\+\s*)?(?:years?|yrs?)\b/gi

/** Lower bound of the main experience requirement ("5+ years", "3-5 years of experience"). */
export function extractYearsMin(text: string): number | null {
  const found: number[] = []
  let m: RegExpExecArray | null
  YEARS_RE.lastIndex = 0
  while ((m = YEARS_RE.exec(text))) {
    const window = text.slice(Math.max(0, m.index - 80), Math.min(text.length, m.index + m[0].length + 80)).toLowerCase()
    if (!/experience|exp\b|working|background|track record|hands[- ]on|professional/.test(window)) continue
    const n = parseInt(m[1], 10)
    if (n > 0 && n <= 30) found.push(n)
  }
  if (!found.length) return null
  // The headline requirement is usually the largest lower bound ("8+ years …, 2+ years with Go").
  return Math.max(...found)
}

const BUCKET_WEIGHT: Record<Bucket, number> = { required: 1, responsibilities: 0.8, intro: 0.6, preferred: 0.4, other: 0 }

export function analyzeJdDeterministic(title: string, description: string): JobRequirementsData {
  const { buckets, headingsFound } = sectionize(description)
  const acc = new Map<string, RequirementItem & { mentions: number }>()
  const bump = (skill: string, weight: number, source: RequirementItem['source'], evidence?: string) => {
    const cur = acc.get(skill)
    if (!cur) acc.set(skill, { skill, weight, source, evidence, mentions: 1 })
    else {
      cur.mentions++
      if (weight > cur.weight) { cur.weight = weight; cur.source = source; cur.evidence = evidence ?? cur.evidence }
    }
  }

  for (const hit of findSkills(title, { snippets: false })) bump(hit.canonical, 1, 'title', `title: ${title}`)

  const unstructured = headingsFound === 0
  for (const bucket of ['required', 'responsibilities', 'intro', 'preferred'] as const) {
    const text = buckets[bucket].join('\n')
    if (!text) continue
    const weight = unstructured ? 0.7 : BUCKET_WEIGHT[bucket]
    for (const hit of findSkills(text, { maxSnippets: 1 })) bump(hit.canonical, weight, bucket, hit.snippets[0])
    // alternatives: a single line like "Strong experience with Go or Java" → one group
    let lineNo = 0
    for (const line of buckets[bucket]) {
      lineNo++
      if (!/\b(or|\/)\s/i.test(line) && !/\w\/\w/.test(line)) continue
      const hits = findSkills(line, { snippets: false })
      if (hits.length < 2 || hits.length > 4) continue
      const group = `${bucket}:${lineNo}`
      for (const h of hits) { const cur = acc.get(h.canonical); if (cur && !cur.group) cur.group = group }
    }
  }

  const required: RequirementItem[] = []
  const preferred: RequirementItem[] = []
  for (const item of acc.values()) {
    const { mentions, ...rest } = item
    const w = Math.min(1, rest.weight + Math.min(0.2, (mentions - 1) * 0.1))
    const out = { ...rest, weight: Math.round(w * 100) / 100 }
    if (rest.source === 'preferred' || out.weight < 0.5) preferred.push(out)
    else required.push(out)
  }
  required.sort((a, b) => b.weight - a.weight || a.skill.localeCompare(b.skill))
  preferred.sort((a, b) => b.weight - a.weight || a.skill.localeCompare(b.skill))

  const reqText = [buckets.required.join('\n'), buckets.intro.join('\n'), buckets.responsibilities.join('\n')].join('\n')
  return {
    extractorVersion: JD_EXTRACTOR_VERSION,
    titleNormalized: normalizeTitle(title) || null,
    seniority: detectSeniority(title, description),
    yearsMin: extractYearsMin(reqText) ?? extractYearsMin(description),
    required,
    preferred,
    keywords: [],
    llmUsed: false,
    sections: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  }
}
