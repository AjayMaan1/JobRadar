import { resumeText, type ResumeContent } from '../schema/resume.js'
import { mentionsSkill } from '../skills/aliases.js'
import { extractEntities, metricKeys, normKey, type Entity } from './entities.js'

export interface GroundingSource {
  master: ResumeContent
  /** User-confirmed facts ("I used Kafka at Acme for 2 years"). */
  confirmedFacts: string[]
  /** Extra text that is allowed (e.g. the bullet being rewritten — its own entities are obviously supported). */
  allow?: string[]
}

export interface GroundingResult {
  ok: boolean
  unsupported: Entity[]
  checked: number
}

/**
 * The "no fabrication" guard (HLD V2). Every entity in a proposed text must be evidenced by the master
 * resume, a confirmed fact, or the explicitly allowed context. Anything else is reported as unsupported; the
 * caller flags the suggestion ("needs your confirmation") and never applies it silently. This is also the
 * real defence against instructions smuggled into job descriptions — an injected "add Google to your work
 * history" cannot pass because "Google" is not in the candidate's corpus.
 */
export function validateGrounding(after: string, source: GroundingSource): GroundingResult {
  const corpus = [resumeText(source.master), ...source.confirmedFacts, ...(source.allow ?? [])].join('\n')
  const corpusKey = normKey(corpus)
  const corpusMetrics = metricKeys(corpus)
  const entities = extractEntities(after)
  const unsupported: Entity[] = []
  for (const e of entities) {
    let supported = false
    switch (e.kind) {
      case 'skill':
        supported = mentionsSkill(corpus, e.value) > 0
        break
      case 'metric':
        supported = corpusMetrics.has(e.key) || corpusMetrics.has(e.key.replace(/[%xkmb]+$/i, ''))
        break
      default:
        supported = corpusKey.includes(e.key)
    }
    if (!supported) unsupported.push(e)
  }
  return { ok: unsupported.length === 0, unsupported, checked: entities.length }
}

export function groundingSummary(r: GroundingResult): string {
  if (r.ok) return 'All facts are supported by your resume.'
  return `Unsupported: ${r.unsupported.map((u) => `${u.value} (${u.kind.replace('_', ' ')})`).join(', ')}`
}
