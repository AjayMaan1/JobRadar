import { SKILLS } from '../skills/aliases.js'

/**
 * Query expansion for software-development roles — the fallback when the embedding model is not running
 * (and a cheap boost to exact search when it is). "software engineer" also finds "software developer",
 * "SDE", "programmer"…; "ai engineer" also finds "machine learning engineer", "LLM engineer"…
 */
export const ROLE_SYNONYMS: string[][] = [
  ['software engineer', 'software developer', 'software development engineer', 'sde', 'swe', 'programmer', 'developer', 'engineer ii', 'member of technical staff', 'mts'],
  ['backend engineer', 'back-end engineer', 'backend developer', 'back end developer', 'server-side engineer', 'api engineer', 'services engineer', 'platform backend'],
  ['frontend engineer', 'front-end engineer', 'frontend developer', 'front end developer', 'ui engineer', 'web developer', 'javascript engineer', 'react developer'],
  ['full stack engineer', 'full-stack engineer', 'fullstack engineer', 'full stack developer', 'full-stack developer', 'web engineer'],
  ['ai engineer', 'machine learning engineer', 'ml engineer', 'deep learning engineer', 'llm engineer', 'genai engineer', 'generative ai engineer', 'applied scientist', 'applied ai', 'mlops engineer', 'ai/ml engineer'],
  ['data engineer', 'data platform engineer', 'etl developer', 'analytics engineer', 'big data engineer', 'data infrastructure engineer'],
  ['data scientist', 'research scientist', 'machine learning scientist', 'quantitative analyst'],
  ['devops engineer', 'site reliability engineer', 'sre', 'platform engineer', 'infrastructure engineer', 'cloud engineer', 'systems engineer', 'release engineer', 'build engineer'],
  ['mobile engineer', 'mobile developer', 'android developer', 'android engineer', 'ios developer', 'ios engineer', 'react native developer', 'flutter developer'],
  ['security engineer', 'application security engineer', 'appsec engineer', 'product security engineer', 'devsecops engineer', 'security researcher'],
  ['qa engineer', 'sdet', 'test automation engineer', 'quality engineer', 'software engineer in test', 'automation engineer'],
  ['engineering manager', 'tech lead', 'technical lead', 'team lead', 'lead engineer', 'head of engineering', 'director of engineering'],
  ['staff engineer', 'principal engineer', 'senior staff engineer', 'distinguished engineer', 'software architect', 'solutions architect', 'technical architect'],
  ['embedded engineer', 'firmware engineer', 'embedded software engineer', 'systems software engineer'],
  ['blockchain engineer', 'smart contract engineer', 'solidity developer', 'web3 developer', 'protocol engineer'],
  ['game developer', 'game engineer', 'gameplay programmer', 'unity developer', 'unreal developer'],
  ['product engineer', 'founding engineer', 'generalist engineer', 'early engineer'],
]

const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, ' ').replace(/\s*-\s*/g, '-').trim()

export interface ExpandedQuery {
  original: string
  /** All terms to OR together in exact search (original first). */
  terms: string[]
  /** Terms added by expansion (for the UI hint). */
  added: string[]
}

/** Expand a free-text query into role synonyms + skill aliases. Max ~14 terms so the SQL stays cheap. */
export function expandQuery(q: string, max = 14): ExpandedQuery {
  const original = q.trim()
  const key = norm(original)
  const added = new Set<string>()
  if (!key) return { original, terms: [], added: [] }

  for (const group of ROLE_SYNONYMS) {
    // exact, the query contains the term, or the query is an unfinished word of the term ("software development eng")
    const hit = group.some((g) => { const n = norm(g); return key === n || key.includes(n) || (key.length >= 4 && n.startsWith(key) && /[a-z]/.test(n[key.length] ?? '')) })
    if (hit) for (const g of group) if (norm(g) !== key) added.add(g)
  }
  // single-token seniority-stripped form: "senior backend engineer" → also match the group for "backend engineer"
  const stripped = key.replace(/\b(senior|sr\.?|junior|jr\.?|staff|principal|lead|mid|intermediate|remote|contract)\b/g, ' ').replace(/\s+/g, ' ').trim()
  if (stripped && stripped !== key) {
    added.add(stripped)
    for (const group of ROLE_SYNONYMS) if (group.some((g) => norm(g) === stripped)) for (const g of group) if (norm(g) !== key) added.add(g)
  }
  // skill aliases: "k8s" ↔ "kubernetes", "golang" ↔ "Go"
  for (const s of SKILLS) {
    const names = [s.canonical, ...s.aliases.map((a) => a.replace(/^=/, ''))]
    if (names.some((n) => norm(n) === key)) for (const n of names) if (norm(n) !== key && n.length > 1) added.add(n)
  }
  const terms = [original, ...[...added].filter((t) => t.length >= 2)].slice(0, max)
  return { original, terms, added: terms.slice(1) }
}
