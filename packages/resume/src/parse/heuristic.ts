import { ResumeContentSchema, type ResumeContent } from '../schema/resume.js'
import { extractContacts } from './contacts.js'

/**
 * Deterministic resume structuring — the fallback when no LLM is running (and the backbone when the LLM
 * call fails). Works on the plain extracted text: section headings → buckets, date ranges → roles, bullets →
 * highlights, "Group: a, b" → skill groups. Conservative: anything it cannot place is kept verbatim in
 * `sections` so nothing is lost; the user fixes the rest on the review screen.
 */
type Bucket = 'summary' | 'experience' | 'education' | 'skills' | 'projects' | 'certificates' | 'languages' | 'other'

const HEADINGS: Array<[Bucket, RegExp]> = [
  ['summary', /^(professional\s+)?(summary|profile|about( me)?|objective|overview)\b/i],
  ['experience', /^((work|professional|employment|relevant)\s+)?(experience|history)\b|^employment\b|^career\b/i],
  ['education', /^(education|academics?|qualifications?)\b/i],
  ['skills', /^((technical|core|key)\s+)?(skills|competencies|technologies|tech(nical)? stack|tools)\b/i],
  ['projects', /^((personal|side|selected|key)\s+)?projects?\b|^open[- ]source\b/i],
  ['certificates', /^(certifications?|certificates?|licenses?|courses?)\b/i],
  ['languages', /^languages?\b/i],
  ['other', /^(awards?|honou?rs|publications?|volunteer(ing)?|interests|hobbies|achievements?|activities|references?|patents?|talks?|speaking)\b/i],
]

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12' }
const MONTH_RE = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const DATE_RE = `(?:${MONTH_RE}\\s+)?(?:\\d{1,2}\\/)?\\d{4}`
const RANGE_RE = new RegExp(`(${DATE_RE})\\s*(?:-|–|—|to|until)\\s*(${DATE_RE}|present|current|now|till date|ongoing)`, 'i')
const BULLET_RE = /^[-•*▪◦·●○■]\s*/

function toIso(d: string): string {
  const s = d.trim().toLowerCase()
  if (/present|current|now|till date|ongoing/.test(s)) return ''
  const m = s.match(/([a-z]+)\.?\s+(\d{4})/)
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4)] ?? MONTHS[m[1].slice(0, 3)]
    if (mon) return `${m[2]}-${mon}`
  }
  const mm = s.match(/(\d{1,2})\/(\d{4})/)
  if (mm) return `${mm[2]}-${mm[1].padStart(2, '0')}`
  const y = s.match(/\d{4}/)
  return y ? y[0] : ''
}

export function headingOf(line: string): Bucket | null {
  const t = line.trim().replace(/^#+\s*/, '').replace(/[:\-–—_]+$/, '').trim()
  if (!t || t.length > 40 || BULLET_RE.test(line)) return null
  if (/:\s*\S/.test(line)) return null // "Languages: Go, Java" is content, not a heading
  const words = t.split(/\s+/).length
  if (words > 4) return null
  // headings are short and usually not sentence-like; accept ALL CAPS or Title Case or known words
  for (const [b, re] of HEADINGS) if (re.test(t)) return b
  return null
}

interface Entry { header: string[]; bullets: string[]; keywords: string[]; start?: string; end?: string }
const KEYWORDS_LINE = /^(technologies|tech(nical)? stack|tools|stack|skills used|environment)\s*:\s*(.+)$/i

/** Split a bucket's lines into entries: a new entry begins at a line with a date range (or, without dates, at a non-bullet line after bullets). */
function entries(lines: string[]): Entry[] {
  const out: Entry[] = []
  let cur: Entry | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const isBullet = BULLET_RE.test(line)
    const kw = line.replace(BULLET_RE, '').match(KEYWORDS_LINE)
    if (kw && cur) { cur.keywords.push(...kw[3].split(/[,;|•·]/).map((k) => k.trim()).filter(Boolean)); continue }
    const range = line.match(RANGE_RE)
    if (range && !isBullet) {
      // date line: starts a new entry unless the current entry has no dates yet and no bullets (title line above)
      if (cur && cur.start === undefined && !cur.bullets.length) {
        cur.start = toIso(range[1]); cur.end = toIso(range[2])
        const rest = line.replace(RANGE_RE, '').replace(/[|·•,–—-]+\s*$/, '').replace(/^\s*[|·•,–—-]+/, '').trim()
        if (rest) cur.header.push(rest)
      } else {
        cur = { header: [], bullets: [], keywords: [], start: toIso(range[1]), end: toIso(range[2]) }
        const rest = line.replace(RANGE_RE, '').replace(/[|·•,–—-]+\s*$/, '').replace(/^\s*[|·•,–—-]+/, '').trim()
        if (rest) cur.header.push(rest)
        out.push(cur)
      }
      continue
    }
    if (isBullet) {
      if (!cur) { cur = { header: [], bullets: [], keywords: [] }; out.push(cur) }
      cur.bullets.push(line.replace(BULLET_RE, '').trim())
      continue
    }
    // plain line: header continuation if the entry has no bullets yet, otherwise a new entry
    if (!cur || cur.bullets.length) { cur = { header: [line], bullets: [], keywords: [] }; out.push(cur) }
    else cur.header.push(line)
  }
  return out
}

/** "Senior Engineer, Acme Payments" | "Senior Engineer at Acme" | "Acme — Senior Engineer" → { position, name } */
function splitTitleCompany(header: string[]): { position: string; name: string; location?: string } {
  const joined = header.join(' | ')
  const parts = joined.split(/\s*(?:\||—|–|·| at | @ )\s*/i).map((p) => p.trim()).filter(Boolean)
  const titleRe = /\b(engineer|developer|manager|lead|architect|scientist|analyst|consultant|intern|director|head|founder|cto|vp|specialist|administrator|designer|programmer|sde|swe)\b/i
  if (parts.length >= 2) {
    const tIdx = parts.findIndex((p) => titleRe.test(p))
    const position = tIdx >= 0 ? parts[tIdx] : parts[0]
    const name = parts.find((p, i) => i !== (tIdx >= 0 ? tIdx : 0) && !/^\(?(remote|hybrid|onsite)/i.test(p)) ?? ''
    const location = parts.find((p) => /\b(remote|hybrid|india|usa|uk|germany|bangalore|bengaluru|gurugram|gurgaon|noida|delhi|mumbai|pune|hyderabad|chennai)\b/i.test(p) && p !== name && p !== position)
    return { position, name, location }
  }
  const comma = joined.split(/,\s*/)
  if (comma.length >= 2) {
    const tIdx = comma.findIndex((p) => titleRe.test(p))
    return { position: comma[tIdx >= 0 ? tIdx : 0].trim(), name: comma[tIdx === 0 || tIdx < 0 ? 1 : 0].trim() }
  }
  return titleRe.test(joined) ? { position: joined, name: '' } : { position: '', name: joined }
}

export function heuristicParse(text: string): ResumeContent {
  const lines = text.replace(/\r/g, '').split('\n')
  const buckets: Record<Bucket, string[]> = { summary: [], experience: [], education: [], skills: [], projects: [], certificates: [], languages: [], other: [] }
  const otherTitles: string[] = []
  const header: string[] = []
  let cur: Bucket | null = null
  let curTitle = ''
  const sectionOrder: string[] = []
  for (const line of lines) {
    const h = headingOf(line)
    if (h) {
      cur = h
      curTitle = line.trim().replace(/^#+\s*/, '').replace(/[:\-–—_]+$/, '').trim()
      sectionOrder.push(curTitle)
      if (h === 'other') { otherTitles.push(curTitle); buckets.other.push(`\u0000${curTitle}`) }
      continue
    }
    if (!line.trim()) { if (cur) buckets[cur].push(''); continue }
    if (!cur) header.push(line.trim())
    else buckets[cur].push(line)
  }

  const contacts = extractContacts(text)
  const headerText = header.filter((l) => !/@|\+?\d[\d\s().-]{7,}|https?:\/\/|linkedin\.com|github\.com/i.test(l))
  const name = (headerText[0] ?? '').slice(0, 80)
  const label = headerText[1] && headerText[1].length <= 90 && !/\d{4}/.test(headerText[1]) ? headerText[1] : undefined
  const location = header.find((l) => /,\s*[A-Za-z ]{2,}$/.test(l) && !/@|http/.test(l) && l !== name && l !== label)?.split(/[|·•]/).map((p) => p.trim()).find((p) => /,/.test(p))

  const work = entries(buckets.experience).filter((e) => e.header.length || e.bullets.length).map((e) => {
    const { position, name: company, location: loc } = splitTitleCompany(e.header)
    return { name: company, position, location: loc, startDate: e.start, endDate: e.end, highlights: e.bullets, keywords: e.keywords }
  })

  const projects = entries(buckets.projects).filter((e) => e.header.length || e.bullets.length).map((e) => ({ name: e.header[0] ?? 'Project', description: e.header.slice(1).join(' ') || undefined, highlights: e.bullets, keywords: e.keywords, startDate: e.start, endDate: e.end }))

  const skills: ResumeContent['skills'] = []
  const loose: string[] = []
  for (const raw of buckets.skills) {
    const line = raw.replace(BULLET_RE, '').trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z][A-Za-z &/+#.-]{1,40}?)\s*[:\-–—]\s+(.+)$/)
    if (m && m[2].includes(',')) skills.push({ name: m[1].trim(), keywords: m[2].split(/[,;|•·]/).map((s) => s.trim()).filter(Boolean) })
    else loose.push(...line.split(/[,;|•·]/).map((s) => s.trim()).filter((s) => s && s.length <= 40))
  }
  if (loose.length) skills.push({ name: 'Skills', keywords: loose })

  const DEGREE_RE = /\b(Ph\.?D\.?|M\.?Tech\.?|B\.?Tech\.?|M\.?Sc\.?|B\.?Sc\.?|MBA|M\.?S\.?|B\.?S\.?|B\.?E\.?|M\.?E\.?|BCA|MCA|B\.?A\.?|M\.?A\.?|Bachelor(?:'s)?(?: of [A-Za-z]+)?|Master(?:'s)?(?: of [A-Za-z]+)?|Diploma)\b/i
  const INST_RE = /university|institute|college|school|iit\b|nit\b|iiit|bits|academy|polytechnic/i
  const education = entries(buckets.education).filter((e) => e.header.length).map((e) => {
    const parts = e.header.join(', ').split(/\s*[,|·•]\s*/).map((p) => p.trim()).filter(Boolean)
    const degreePart = parts.find((p) => DEGREE_RE.test(p))
    const degree = degreePart?.match(DEGREE_RE)?.[0]
    const areaFromDegree = degreePart?.replace(DEGREE_RE, '').replace(/^\s*(in|of)\s+/i, '').replace(/[()]/g, '').trim()
    const inst = parts.find((p) => INST_RE.test(p)) ?? parts.find((p) => p !== degreePart && !/^\(?(19|20)\d{2}/.test(p)) ?? ''
    const year = e.end || e.start || (parts.join(' ').match(/\b(19|20)\d{2}\b/)?.[0] ?? '')
    return { institution: inst, studyType: degree, area: areaFromDegree || undefined, endDate: year || undefined, courses: [] as string[] }
  })

  const certificates = buckets.certificates.map((l) => l.replace(BULLET_RE, '').trim()).filter(Boolean).map((l) => ({ name: l.replace(/\s*\(?\b(19|20)\d{2}\)?\s*$/, '').trim(), date: l.match(/\b(19|20)\d{2}\b/)?.[0] }))
  const languages = buckets.languages.map((l) => l.replace(BULLET_RE, '').trim()).filter(Boolean).flatMap((l) => l.split(/[,;|•·]/)).map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/^(.+?)\s*[(\-–—:]\s*(.+?)\)?$/); return m ? { language: m[1].trim(), fluency: m[2].trim() } : { language: l } })

  const sections: ResumeContent['sections'] = []
  let curOther: { title: string; items: string[] } | null = null
  for (const l of buckets.other) {
    if (l.startsWith('\u0000')) { curOther = { title: l.slice(1), items: [] }; sections.push(curOther); continue }
    const t = l.replace(BULLET_RE, '').trim()
    if (t && curOther) curOther.items.push(t)
  }

  const summary = buckets.summary.map((l) => l.trim()).filter(Boolean).join(' ')
  const content = {
    basics: { name, label, email: contacts.email, phone: contacts.phone, url: contacts.urls[0], summary: summary || undefined, location: location ? { city: location.split(',')[0].trim(), region: location.split(',').slice(1).join(',').trim() || undefined } : undefined, profiles: contacts.urls.slice(1).map((u) => ({ network: /linkedin/i.test(u) ? 'LinkedIn' : /github/i.test(u) ? 'GitHub' : 'Web', url: u })) },
    work, education, skills, projects, certificates, languages, sections,
    meta: { sectionOrder },
  }
  // keep anything that went nowhere (no headings at all) as a raw section so the user can fix it
  if (!work.length && !skills.length && !education.length && !summary) {
    content.sections.push({ title: 'Unparsed resume text', items: text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean) })
  }
  return ResumeContentSchema.parse(content)
}
