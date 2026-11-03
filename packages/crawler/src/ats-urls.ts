/**
 * ATS URL intelligence: detect the ATS + slug from apply/careers URLs or HTML, and build
 * list-endpoint URLs per ATS. Pure functions — no I/O.
 */
export type KnownAts =
  | 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters'
  | 'recruitee' | 'teamtailor' | 'personio' | 'bamboohr' | 'rippling' | 'workday'

export interface AtsRef {
  ats: KnownAts
  slug: string
  host: string
  careersUrl: string
}

const URL_PATTERNS: Array<{ ats: KnownAts; re: RegExp; slug: (m: RegExpMatchArray) => string; host: (m: RegExpMatchArray) => string }> = [
  { ats: 'greenhouse', re: /https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/i, slug: (m) => m[1].toLowerCase(), host: () => 'boards-api.greenhouse.io' },
  { ats: 'greenhouse', re: /https?:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i, slug: (m) => m[1].toLowerCase(), host: () => 'boards-api.greenhouse.io' },
  { ats: 'greenhouse', re: /greenhouse\.io\/embed\/job_board(?:\/js)?\?(?:.*&)?for=([a-z0-9_-]+)/i, slug: (m) => m[1].toLowerCase(), host: () => 'boards-api.greenhouse.io' },
  { ats: 'lever', re: /https?:\/\/jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/i, slug: (m) => m[1].toLowerCase(), host: () => 'api.lever.co' },
  { ats: 'lever', re: /https?:\/\/api\.(?:eu\.)?lever\.co\/v0\/postings\/([a-z0-9_-]+)/i, slug: (m) => m[1].toLowerCase(), host: () => 'api.lever.co' },
  { ats: 'ashby', re: /https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i, slug: (m) => m[1].toLowerCase(), host: () => 'api.ashbyhq.com' },
  { ats: 'ashby', re: /https?:\/\/api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9_.-]+)/i, slug: (m) => m[1].toLowerCase(), host: () => 'api.ashbyhq.com' },
  { ats: 'workable', re: /https?:\/\/apply\.workable\.com\/([a-z0-9_-]+)/i, slug: (m) => m[1].toLowerCase(), host: () => 'apply.workable.com' },
  { ats: 'workable', re: /https?:\/\/([a-z0-9_-]+)\.workable\.com(?:\/|$)/i, slug: (m) => m[1].toLowerCase(), host: () => 'apply.workable.com' },
  { ats: 'smartrecruiters', re: /https?:\/\/(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/i, slug: (m) => m[1], host: () => 'api.smartrecruiters.com' },
  { ats: 'recruitee', re: /https?:\/\/([a-z0-9_-]+)\.recruitee\.com/i, slug: (m) => m[1].toLowerCase(), host: (m) => `${m[1].toLowerCase()}.recruitee.com` },
  { ats: 'teamtailor', re: /https?:\/\/([a-z0-9_-]+)\.teamtailor\.com/i, slug: (m) => m[1].toLowerCase(), host: (m) => `${m[1].toLowerCase()}.teamtailor.com` },
  { ats: 'personio', re: /https?:\/\/([a-z0-9_-]+)\.jobs\.personio\.(?:de|com)/i, slug: (m) => m[1].toLowerCase(), host: (m) => `${m[1].toLowerCase()}.jobs.personio.de` },
  { ats: 'bamboohr', re: /https?:\/\/([a-z0-9_-]+)\.bamboohr\.com\/(?:careers|jobs)/i, slug: (m) => m[1].toLowerCase(), host: (m) => `${m[1].toLowerCase()}.bamboohr.com` },
  { ats: 'rippling', re: /https?:\/\/ats\.rippling\.com\/([a-z0-9_-]+)/i, slug: (m) => m[1].toLowerCase(), host: () => 'ats.rippling.com' },
  // workday: https://{tenant}.wd5.myworkdayjobs.com/{site}/... slug = "{host}/{site}"
  { ats: 'workday', re: /https?:\/\/([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/, slug: (m) => `${m[1].toLowerCase()}/${m[2]}`, host: (m) => m[1].toLowerCase() },
]

/** Detect an ATS board reference from any URL (apply URL, careers URL, embed URL). */
export function atsRefFromUrl(url: string | null | undefined): AtsRef | null {
  if (!url) return null
  for (const p of URL_PATTERNS) {
    const m = url.match(p.re)
    if (m) {
      const slug = p.slug(m)
      if (!slug || ['jobs', 'job', 'embed', 'v1', 'v0', 'api', 'careers'].includes(slug)) continue
      return { ats: p.ats, slug, host: p.host(m), careersUrl: careersUrlFor(p.ats, slug) }
    }
  }
  return null
}

/** Scan HTML of a careers page for embedded ATS references (script src, iframes, links). */
export function atsRefsFromHtml(html: string, pageUrl: string): AtsRef[] {
  const found = new Map<string, AtsRef>()
  const self = atsRefFromUrl(pageUrl)
  if (self) found.set(`${self.ats}:${self.slug}`, self)
  const urlRe = /https?:\/\/[^\s"'<>()]+/g
  for (const m of html.matchAll(urlRe)) {
    const ref = atsRefFromUrl(m[0])
    if (ref) found.set(`${ref.ats}:${ref.slug}`, ref)
    if (found.size >= 5) break
  }
  return [...found.values()]
}

export function careersUrlFor(ats: KnownAts, slug: string): string {
  switch (ats) {
    case 'greenhouse': return `https://boards.greenhouse.io/${slug}`
    case 'lever': return `https://jobs.lever.co/${slug}`
    case 'ashby': return `https://jobs.ashbyhq.com/${slug}`
    case 'workable': return `https://apply.workable.com/${slug}/`
    case 'smartrecruiters': return `https://careers.smartrecruiters.com/${slug}`
    case 'recruitee': return `https://${slug}.recruitee.com/`
    case 'teamtailor': return `https://${slug}.teamtailor.com/jobs`
    case 'personio': return `https://${slug}.jobs.personio.de/`
    case 'bamboohr': return `https://${slug}.bamboohr.com/careers`
    case 'rippling': return `https://ats.rippling.com/${slug}/jobs`
    case 'workday': return `https://${slug}`
  }
}

export function apiUrlFor(ats: KnownAts, slug: string): string {
  switch (ats) {
    case 'greenhouse': return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
    case 'lever': return `https://api.lever.co/v0/postings/${slug}?mode=json`
    case 'ashby': return `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`
    case 'workable': return `https://apply.workable.com/api/v3/accounts/${slug}/jobs`
    case 'smartrecruiters': return `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`
    case 'recruitee': return `https://${slug}.recruitee.com/api/offers/`
    case 'teamtailor': return `https://${slug}.teamtailor.com/jobs.json`
    case 'personio': return `https://${slug}.jobs.personio.de/search.json`
    case 'bamboohr': return `https://${slug}.bamboohr.com/careers/list`
    case 'rippling': return `https://ats.rippling.com/api/v2/board/${slug}/jobs`
    case 'workday': {
      // slug = "{tenant}.wdN.myworkdayjobs.com/{site}"
      const [host, site] = slug.split('/')
      const tenant = host.split('.')[0]
      return `https://${host}/wday/cxs/${tenant}/${site}/jobs`
    }
  }
}

export function hostFor(ats: KnownAts, slug: string): string {
  return new URL(apiUrlFor(ats, slug)).hostname
}

export function costClassFor(ats: KnownAts): 'cheap' | 'medium' | 'expensive' {
  switch (ats) {
    case 'greenhouse':
    case 'lever':
    case 'ashby':
    case 'workable':
      return 'cheap'
    case 'smartrecruiters':
    case 'recruitee':
    case 'teamtailor':
    case 'personio':
    case 'bamboohr':
    case 'rippling':
      return 'medium'
    case 'workday':
      return 'expensive'
  }
}

/** Strip tracking params / fragments / trailing slashes so the same posting URL hashes equal. */
export function normalizeJobUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    const drop = [...u.searchParams.keys()].filter((k) => /^(utm_|ref$|source$|gh_src$|lever-source|src$|fbclid|gclid|_ga)/i.test(k))
    for (const k of drop) u.searchParams.delete(k)
    u.hash = ''
    let s = u.toString()
    if (s.endsWith('/')) s = s.slice(0, -1)
    return s.toLowerCase()
  } catch {
    return raw.trim().toLowerCase()
  }
}
