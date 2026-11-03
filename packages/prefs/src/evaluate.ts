import { eligibleFor, fromUSD, type JobFacts } from '@jobradar/extractor'
import type { Preferences, Tier, TierCondition } from './schema.js'
import { utcOffsetOf } from './schema.js'

/**
 * evaluate(facts, prefs) → tier / eligibility / score / reasons (HLD dynamic preferences §6).
 * Pure and versioned: golden tests pin outputs; every stored eval records EVALUATOR_VERSION + prefs version.
 *
 * Score (0..100, freshness is added at read time exactly as before):
 *   tier points (≤ 40) + pay bands (≤ 30) + role fit (≤ 15) + salary transparency (≤ 5) + source quality (≤ 5)
 */
export const EVALUATOR_VERSION = 'eval-v1'

export interface EvalJobInput {
  title: string
  company: string
  /** User-independent quality 0..100 (company or source), resolved by the caller. */
  quality: number | null
  facts: JobFacts
}

export interface EvalComponents { tier: number; pay: number; roleFit: number; transparency: number; sourceQuality: number }

export interface EvalResult {
  tier: string
  tierLabel: string | null
  eligible: boolean
  eligibility: { confidence: 'strong' | 'weak' | 'none'; reason: string }
  score: number
  components: EvalComponents
  reasons: string[]
  /** Why the job is excluded from the feed entirely (employment type, company, pay floor) — null when it is shown. */
  excluded: string | null
}

const metrosOf = (spec: 'home.metros' | string[] | undefined, prefs: Preferences): string[] => (spec === 'home.metros' || spec === undefined ? prefs.home.metros : spec)

function matchCondition(when: TierCondition, job: EvalJobInput, prefs: Preferences, elig: { eligible: boolean }, paysFloor: boolean | null): { ok: boolean; why: string[] } {
  const f = job.facts
  const why: string[] = []
  if (when.workMode && !when.workMode.includes(f.workMode === 'unknown' ? 'onsite' : f.workMode)) return { ok: false, why }
  if (when.workMode) why.push(f.workMode)
  if (when.eligibleForMe) {
    if (!elig.eligible) return { ok: false, why }
    why.push('eligible from ' + prefs.home.country)
  }
  if (when.locationCountry) {
    const want = when.locationCountry === 'home' ? prefs.home.country : when.locationCountry.toUpperCase()
    if (!f.locations.some((l) => l.country === want)) return { ok: false, why }
    why.push(`location: ${want}`)
  }
  if (when.locationMetro) {
    const metros = metrosOf(when.locationMetro, prefs)
    const hit = f.locations.find((l) => l.metro && metros.includes(l.metro))
    if (!hit) return { ok: false, why }
    why.push(`metro: ${hit.metro}`)
  }
  if (when.companyTag && when.companyTag.length) {
    const tags = f.company.tags
    const hit = when.companyTag.find((t) => tags.includes(t.toLowerCase()))
    if (!hit) return { ok: false, why }
    why.push(`company: ${hit}`)
  }
  if (when.paysFloor) {
    if (paysFloor !== true) return { ok: false, why }
    why.push('pays ≥ floor')
  }
  return { ok: true, why }
}

function payPoints(facts: JobFacts, prefs: Preferences): { pts: number; paysFloor: boolean | null; inUserCurrency: number | null } {
  if (!facts.salary || !facts.salary.usdMin) return { pts: 0, paysFloor: null, inUserCurrency: null }
  const minUser = fromUSD(facts.salary.usdMin, prefs.pay.currency)
  if (!minUser) return { pts: 0, paysFloor: null, inUserCurrency: null }
  const paysFloor = prefs.pay.floor === null ? true : minUser >= prefs.pay.floor
  let pts = 0
  for (const b of [...prefs.pay.bands].sort((a, b) => b.min - a.min)) if (minUser >= b.min) { pts = b.pts; break }
  return { pts: Math.min(30, pts), paysFloor, inUserCurrency: minUser }
}

function roleFitPoints(job: EvalJobInput, prefs: Preferences): { pts: number; why: string[] } {
  const why: string[] = []
  let pts = 0
  const target = new Set(prefs.role.skills.map((s) => s.toLowerCase()))
  const matched = job.facts.skills.filter((s) => target.has(s.toLowerCase()))
  if (matched.length) { pts += Math.min(matched.length * 2, 8); why.push(`skills: ${matched.slice(0, 4).join(', ')}`) }
  const titleLower = job.title.toLowerCase()
  const titleHit = prefs.role.targetTitles.some((t) => t && titleLower.includes(t.toLowerCase().replace(/\b(senior|junior|lead|staff|sr\.?|jr\.?)\b/g, '').trim()))
  if ((job.facts.category && (prefs.role.categories as string[]).includes(job.facts.category)) || titleHit) { pts += 4; why.push(titleHit ? 'target title' : `category: ${job.facts.category}`) }
  if (job.facts.seniority && (prefs.role.seniority as string[]).includes(job.facts.seniority)) { pts += 3; why.push(`seniority: ${job.facts.seniority}`) }
  return { pts: Math.min(pts, 15), why }
}

export function evaluate(job: EvalJobInput, prefs: Preferences): EvalResult {
  const f = job.facts
  const tz = prefs.home.utcOffset ?? utcOffsetOf(prefs.home.timezone, null)
  const el = eligibleFor(f, prefs.home.country, tz)
  const pay = payPoints(f, prefs)
  const role = roleFitPoints(job, prefs)
  const transparency = f.salary ? (f.salary.min && f.salary.max ? 5 : 3) : 0
  const sourceQuality = Math.round((Math.min(100, Math.max(0, typeof job.quality === 'number' ? job.quality : 50)) / 100) * 5)

  // Hard exclusions (never shown in the feed, never alerted) — explained, not silent.
  let excluded: string | null = null
  if (f.company.hqCountry && prefs.companies.excludeHqCountries.includes(f.company.hqCountry)) excluded = `company HQ in ${f.company.hqCountry}`
  else if (prefs.companies.exclude.some((c) => c.toLowerCase() === job.company.toLowerCase())) excluded = 'company excluded'
  else if (prefs.companies.onlyTags.length && !prefs.companies.onlyTags.some((t) => f.company.tags.includes(t.toLowerCase()))) excluded = 'company not in allowed tags'
  else if (!(prefs.role.employmentTypes as string[]).includes(f.employmentType) && f.employmentType !== 'unknown') excluded = `employment type: ${f.employmentType}`
  else if (pay.paysFloor === false) excluded = `below pay floor (${prefs.pay.currency} ${pay.inUserCurrency?.toLocaleString('en-US')})`
  else if (prefs.pay.requireTransparency && !f.salary) excluded = 'no published salary'

  let tier: Tier | null = null
  let tierWhy: string[] = []
  if (!excluded) {
    for (const t of prefs.tiers) {
      if (!t.enabled) continue
      const m = matchCondition(t.when, job, prefs, el, pay.paysFloor)
      if (m.ok) { tier = t; tierWhy = m.why; break }
    }
  }
  const components: EvalComponents = { tier: tier?.points ?? 0, pay: pay.pts, roleFit: role.pts, transparency, sourceQuality }
  const score = Math.min(100, Math.max(0, components.tier + components.pay + components.roleFit + components.transparency + components.sourceQuality))
  const reasons = excluded ? [excluded] : [...tierWhy, ...(pay.pts ? [`pay band +${pay.pts}`] : []), ...role.why, ...(el.confidence !== 'none' && !tierWhy.some((w) => w.startsWith('eligible')) && f.workMode === 'remote' ? [el.reason] : [])]
  return {
    tier: tier?.id ?? 'none',
    tierLabel: tier?.label ?? null,
    eligible: el.eligible,
    eligibility: { confidence: el.confidence, reason: el.reason },
    score,
    components,
    reasons: reasons.slice(0, 6),
    excluded,
  }
}

/** Tier ids a posting could alert on for this user (enabled tiers flagged instant). */
export function instantTierIds(prefs: Preferences): Set<string> {
  return new Set(prefs.tiers.filter((t) => t.enabled && t.instant).map((t) => t.id))
}
