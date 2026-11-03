import { findSkills } from '../skills/aliases.js'

export type EntityKind = 'skill' | 'metric' | 'year' | 'proper_noun' | 'certification' | 'degree'

export interface Entity {
  kind: EntityKind
  value: string
  /** Normalised comparison key. */
  key: string
}

const CERT_WORD = '(?:Solutions?|Architect|Professional|Associate|Developer|Engineer|Administrator|Practitioner|Expert|Specialist|Foundations?|Security|Data|Cloud|DevOps|Machine Learning|Application|Kubernetes|Master|Scrum|Product|Owner|Network)'
const CERT_RE = new RegExp(`\\b((?:AWS|GCP|Google Cloud|Google|Azure|Microsoft|Oracle|Cisco|Red Hat|HashiCorp|Salesforce|Databricks|Snowflake)\\s+Certified(?:\\s+${CERT_WORD})*|Certified(?:\\s+${CERT_WORD})+|(?:CKA|CKAD|CKS|PMP|CSM|CSPO|CISSP|CEH|OSCP|CCNA|CCNP|TOGAF))\\b`, 'g')
const DEGREE_RE = /\b(Ph\.?D\.?|M\.?Sc\.?|B\.?Sc\.?|M\.?Tech\.?|B\.?Tech\.?|MBA|M\.?S\.?|B\.?S\.?|B\.?E\.?|M\.?E\.?|BCA|MCA|Bachelor(?:'s)?|Master(?:'s)?|Doctorate)\b/g
const METRIC_RE = /(?<![\w.])(?:\$|€|£|₹)?\d[\d,]*(?:\.\d+)?\s?(?:%|x|X|k|K|M|B|MM|bn|mn|ms|s|hrs?|hours?|days?|weeks?|months?|users?|customers?|requests?|rps|qps|TPS|engineers?|people|teams?|services?|clients?|countries|markets)?(?![\w.])/g
const YEAR_RE = /\b(19[7-9]\d|20[0-4]\d)\b/g
// Two or more Capitalised words in a row (Acme Payments, Google Cloud, New York). Sentence-initial single words are ignored.
const PROPER_RE = /\b([A-Z][a-zA-Z0-9+#.]*(?:\s+(?:of|for|and|&|de|du)\s+)?(?:\s+[A-Z][a-zA-Z0-9+#.]*)+)\b/g

const GENERIC_PROPER = new Set(['Senior Software', 'Software Engineer', 'Senior Engineer', 'Backend Engineer', 'Frontend Engineer', 'Staff Engineer', 'Tech Lead', 'Team Lead', 'Engineering Manager', 'Product Manager', 'Full Stack', 'Computer Science', 'Machine Learning', 'Data Science', 'Site Reliability', 'Platform Engineer', 'Principal Engineer', 'Lead Engineer', 'Software Developer', 'Cloud Engineer', 'DevOps Engineer', 'Data Engineer'])

export function normKey(s: string): string {
  return s.toLowerCase().replace(/[\s,]+/g, ' ').replace(/\.$/, '').trim()
}

/** Entities that a rewrite could fabricate: skills, numbers, years, named things, certifications, degrees. */
export function extractEntities(text: string): Entity[] {
  const out: Entity[] = []
  const seen = new Set<string>()
  const push = (kind: EntityKind, value: string, key = normKey(value)) => {
    const k = `${kind}:${key}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ kind, value, key })
  }
  for (const h of findSkills(text, { snippets: false })) push('skill', h.canonical, h.canonical.toLowerCase())
  for (const m of text.matchAll(CERT_RE)) push('certification', (m[1] ?? m[2]).trim())
  for (const m of text.matchAll(DEGREE_RE)) push('degree', m[1], m[1].replace(/\./g, '').toLowerCase())
  for (const m of text.matchAll(YEAR_RE)) push('year', m[1])
  for (const m of text.matchAll(METRIC_RE)) {
    const v = m[0].trim()
    if (/^(19[7-9]\d|20[0-4]\d)$/.test(v)) continue // years handled above
    push('metric', v, metricKey(v))
  }
  for (const m of text.matchAll(PROPER_RE)) {
    let v = m[1].trim()
    // sentence-initial word is usually a verb ("Scaled Kafka"): drop it and keep the rest only if still a phrase
    const atStart = m.index === 0 || /[.;:!?•\-]\s*$/.test(text.slice(0, m.index))
    if (atStart) {
      const rest = v.split(/\s+/).slice(1).join(' ')
      if (rest.split(/\s+/).length < 2) continue
      v = rest
    }
    if (GENERIC_PROPER.has(v) || v.split(/\s+/).length > 5) continue
    if (findSkills(v, { snippets: false }).length >= v.split(/\s+/).length) continue // all words are skills
    push('proper_noun', v)
  }
  return out
}

/** "2,000 users" → "2000"; "40%" → "40%"; "2M events" → "2m"; "$1.5M" → "$1.5m". Units words are dropped. */
export function metricKey(v: string): string {
  const m = v.replace(/[,\s]/g, '').match(/^([$€£₹]?\d+(?:\.\d+)?)(%|x|k|m|b|mm|bn|mn)?/i)
  return m ? `${m[1]}${(m[2] ?? '').toLowerCase()}` : v.toLowerCase()
}

/** All metric keys present in a corpus (for set membership checks). */
export function metricKeys(text: string): Set<string> {
  const s = new Set<string>()
  for (const m of text.matchAll(METRIC_RE)) s.add(metricKey(m[0].trim()))
  return s
}
