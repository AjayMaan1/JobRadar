import { z } from 'zod'

/**
 * The preference document (HLD dynamic preferences §5). Closed vocabulary: every field is validated, `when`
 * conditions come from a fixed set, so evaluation is deterministic and explainable. Placeholders
 * ("home", "home.metros") make presets portable between users.
 */
export const PREFS_SCHEMA_VERSION = 1

export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const
export const EMPLOYMENT_TYPES = ['full_time', 'contract', 'part_time', 'internship', 'unknown'] as const
export const SENIORITIES = ['junior', 'mid', 'senior', 'lead', 'staff', 'principal', 'manager'] as const
export const CATEGORIES = ['Backend', 'Frontend', 'Full Stack', 'DevOps', 'AI/ML', 'Data', 'Security', 'Product', 'Design'] as const

const iso2 = z.string().regex(/^[A-Z]{2}$/, 'ISO-3166 alpha-2 country code')
const metroId = z.string().regex(/^[a-z0-9-]{2,40}$/)

export const TierConditionSchema = z.object({
  /** Work modes the posting must have (any of). */
  workMode: z.array(z.enum(WORK_MODES)).optional(),
  /** The candidate must be eligible to apply from their home country (geo facts). */
  eligibleForMe: z.boolean().optional(),
  /** Posting location must name this country: "home" = prefs.home.country, or an ISO-2 code. */
  locationCountry: z.string().optional(),
  /** Posting location must be in one of these metros: "home.metros" or explicit metro ids. */
  locationMetro: z.union([z.literal('home.metros'), z.array(metroId)]).optional(),
  /** Company must carry at least one of these tags (mnc, big_tech, anchor, remote_first, yc…). */
  companyTag: z.array(z.string().max(40)).optional(),
  /** Posting must publish a salary at or above the user's floor. */
  paysFloor: z.boolean().optional(),
})

export const TierSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  label: z.string().min(1).max(60),
  enabled: z.boolean().default(true),
  /** Instant alert candidates (channels may further restrict). */
  instant: z.boolean().default(false),
  /** Points added to the user score (the legacy class band). */
  points: z.number().int().min(0).max(60).default(0),
  when: TierConditionSchema,
})

export const PreferencesSchema = z.object({
  schemaVersion: z.literal(PREFS_SCHEMA_VERSION).default(PREFS_SCHEMA_VERSION),
  home: z.object({
    country: iso2,
    metros: z.array(metroId).max(10).default([]),
    timezone: z.string().min(1).max(64).default('UTC'),
    /** UTC offset in hours when the IANA name is unknown to the server; derived from `timezone` otherwise. */
    utcOffset: z.number().min(-12).max(14).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  }),
  work: z.object({
    modes: z.array(z.enum(WORK_MODES)).min(1).default(['remote']),
    hybridMetros: z.union([z.literal('home.metros'), z.array(metroId)]).default('home.metros'),
    onsiteMetros: z.union([z.literal('home.metros'), z.array(metroId)]).default('home.metros'),
  }),
  role: z.object({
    targetTitles: z.array(z.string().max(80)).max(20).default([]),
    categories: z.array(z.enum(CATEGORIES)).default([]),
    seniority: z.array(z.enum(SENIORITIES)).default([]),
    skills: z.array(z.string().max(40)).max(100).default([]),
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).min(1).default(['full_time', 'contract']),
  }),
  pay: z.object({
    /** Annual floor in `currency`; null = no floor. */
    floor: z.number().min(0).nullable().default(null),
    currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
    /** Descending bands: salary ≥ min (in `currency`) → pts. */
    bands: z.array(z.object({ min: z.number().min(0), pts: z.number().int().min(0).max(40) })).max(8).default([]),
    requireTransparency: z.boolean().default(false),
  }),
  companies: z.object({
    excludeHqCountries: z.array(iso2).default([]),
    exclude: z.array(z.string().max(80)).max(200).default([]),
    onlyTags: z.array(z.string().max(40)).default([]),
  }),
  tiers: z.array(TierSchema).min(1).max(8),
  feed: z.object({
    defaultTiers: z.array(z.string()).default([]),
    hideEmploymentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).default(['internship', 'part_time']),
    sort: z.enum(['newest', 'score']).default('newest'),
  }),
  alerts: z.object({
    digestHour: z.number().int().min(0).max(23).default(8),
    quietHours: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)]).nullable().default(null),
  }),
})

export type Preferences = z.infer<typeof PreferencesSchema>
export type Tier = z.infer<typeof TierSchema>
export type TierCondition = z.infer<typeof TierConditionSchema>

/** Parse + cross-field checks (tier ids unique, feed.defaultTiers ⊆ tiers, hybrid metros present when hybrid is on). */
export function parsePreferences(input: unknown): Preferences {
  const p = PreferencesSchema.parse(input)
  const ids = new Set<string>()
  for (const t of p.tiers) {
    if (ids.has(t.id)) throw new Error(`Duplicate tier id "${t.id}"`)
    ids.add(t.id)
  }
  for (const id of p.feed.defaultTiers) if (!ids.has(id)) throw new Error(`feed.defaultTiers references unknown tier "${id}"`)
  if (!p.feed.defaultTiers.length) p.feed.defaultTiers = p.tiers.filter((t) => t.enabled).map((t) => t.id)
  return p
}

/** Non-fatal advice shown in the editor (a doc can be saved with warnings). */
export function lintPreferences(p: Preferences): string[] {
  const out: string[] = []
  if (p.work.modes.includes('hybrid') && p.work.hybridMetros === 'home.metros' && !p.home.metros.length) out.push('You accept hybrid roles but have no home metro — hybrid tiers will never match.')
  if (p.tiers.some((t) => t.enabled && t.when.locationMetro === 'home.metros') && !p.home.metros.length) out.push('A tier matches on your home metros but none are set.')
  if (!p.tiers.some((t) => t.enabled)) out.push('All tiers are disabled — nothing will reach your feed.')
  if (!p.role.skills.length && !p.role.targetTitles.length) out.push('No target skills or titles — role-fit points will always be 0 (upload a resume to seed them).')
  if (p.pay.floor !== null && !p.pay.bands.length) out.push('A pay floor without pay bands: postings above the floor all score the same on pay.')
  return out
}

/** IANA zone → UTC offset (hours) for "now"; falls back to `utcOffset` or 0. */
export function utcOffsetOf(timezone: string, fallback?: number | null): number {
  try {
    const now = new Date()
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' }).formatToParts(now)
    const tzn = parts.find((x) => x.type === 'timeZoneName')?.value ?? ''
    const m = tzn.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (!m) return tzn === 'GMT' || tzn === 'UTC' ? 0 : (fallback ?? 0)
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0))
  } catch {
    return fallback ?? 0
  }
}
