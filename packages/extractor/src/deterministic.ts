import type { RawJob } from '@jobradar/crawler'
import { parseSalary } from './salary-parser.js'
import { detectEligibility } from './eligibility-detector.js'

export interface ExtractedJob {
  title: string
  company: string
  applyUrl: string
  sourceUrl?: string
  description: string
  postedAt?: string
  salary?: ReturnType<typeof parseSalary>
  location?: string
  eligibility: ReturnType<typeof detectEligibility>
  tags: string[]
  seniority?: string
  category?: string
  remoteType: 'remote' | 'hybrid' | 'onsite' | 'unknown'
  sourceFingerprint: string
  extractionMethod: 'deterministic' | 'llm'
  confidence: number
}

const SENIORITY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(staff|principal)\b/i, 'staff'],
  [/\b(lead|tech lead)\b/i, 'lead'],
  [/\b(senior|sr\.?)\b/i, 'senior'],
  [/\b(junior|jr\.?|entry[- ]level)\b/i, 'junior'],
  [/\b(mid[- ]level|mid)\b/i, 'mid'],
  [/\b(manager|director|head of|vp)\b/i, 'manager'],
]

const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(machine learning|ml engineer|ai engineer|llm|nlp|pytorch|tensorflow)\b/i, 'AI/ML'],
  [/\b(data engineer|data scientist|analytics|spark|airflow|dbt)\b/i, 'Data'],
  [/\b(devops|sre|platform engineer|infra|kubernetes|k8s|terraform|ci\/cd)\b/i, 'DevOps'],
  [/\b(frontend|front[- ]end|react|vue|angular|ui engineer)\b/i, 'Frontend'],
  [/\b(backend|back[- ]end|api|server[- ]side|java|go|python|node\.?js)\b/i, 'Backend'],
  [/\b(full[- ]?stack)\b/i, 'Full Stack'],
  [/\b(security|appsec|devsecops|penetration|soc)\b/i, 'Security'],
  [/\b(product manager|pm|product owner)\b/i, 'Product'],
  [/\b(design|ux|ui\/ux|figma)\b/i, 'Design'],
]

const REMOTE_TYPE_PATTERNS: Array<[RegExp, 'remote' | 'hybrid' | 'onsite']> = [
  [/\bhybrid\b/i, 'hybrid'],
  [/\bon[- ]?site|in[- ]?office|on[- ]?premise\b/i, 'onsite'],
  [/\b(fully remote|100% remote|remote[- ]first|work from anywhere|remote work|worldwide|global|anywhere)\b/i, 'remote'],
  [/\bremote\b/i, 'remote'],
]

function detectSeniority(title: string): string | undefined {
  for (const [pattern, level] of SENIORITY_PATTERNS) {
    if (pattern.test(title)) return level
  }
  return undefined
}

function detectCategory(title: string, tags: string[]): string | undefined {
  const text = `${title} ${tags.join(' ')}`
  for (const [pattern, cat] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return cat
  }
  return undefined
}

function detectRemoteType(description: string, location: string | undefined): 'remote' | 'hybrid' | 'onsite' | 'unknown' {
  const text = `${description} ${location ?? ''}`
  for (const [pattern, type] of REMOTE_TYPE_PATTERNS) {
    if (pattern.test(text)) return type
  }
  return 'unknown'
}

export function deterministicExtract(raw: RawJob): ExtractedJob | null {
  const applyUrl = raw.applyUrl ?? raw.sourceUrl
  if (!raw.title || !raw.company || !applyUrl) return null

  // Accept jobs even without description — ATS sources (Workday, Greenhouse, etc.)
  // often omit descriptions in listing feeds to avoid extra per-job API calls.
  const description = raw.description ?? ''

  const salary = parseSalary(raw.salary)
  const eligibility = detectEligibility(description, raw.location)
  const seniority = detectSeniority(raw.title)
  const category = detectCategory(raw.title, raw.tags ?? [])
  const remoteType = detectRemoteType(description, raw.location)

  // Start with lower confidence for sparse jobs, build up from signals
  let confidence = description.length < 50 ? 0.4 : 0.6
  if (salary) confidence += 0.15
  if (eligibility.confidence > 0.7) confidence += 0.1
  if (seniority) confidence += 0.05
  if (category) confidence += 0.05
  confidence = Math.min(confidence, 0.95)

  return {
    title: raw.title.trim(),
    company: raw.company.trim(),
    applyUrl,
    sourceUrl: raw.sourceUrl ?? raw.applyUrl,
    description,
    postedAt: raw.postedAt,
    salary,
    location: raw.location,
    eligibility,
    tags: raw.tags ?? [],
    seniority,
    category,
    remoteType,
    sourceFingerprint: raw.sourceFingerprint,
    extractionMethod: 'deterministic',
    confidence,
  }
}
