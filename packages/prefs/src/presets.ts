import type { Preferences } from './schema.js'

/**
 * System presets. `legacy-india-remote` reproduces today's P1/P2/P3 behaviour, INR bands, NCR hybrid and the
 * India-HQ exclusion exactly (golden-tested), so the owner's upgrade is behaviour-preserving.
 */
const LEGACY_SKILLS = ['Java', 'Go', 'Golang', 'Node.js', 'NodeJS', 'Python', 'TypeScript', 'JavaScript', 'AWS', 'React', 'Kubernetes', 'K8s', 'FastAPI', 'Spring', 'Spring Boot', 'Kafka', 'PostgreSQL', 'Docker', 'Terraform', 'PyTorch', 'LangChain', 'Next.js', 'GraphQL', 'Redis', 'Elasticsearch', 'Microservices', 'GCP', 'Azure', 'CI/CD', 'gRPC', 'REST', 'API']

/**
 * Tiers are evaluated in order, first match wins, so the more specific rule ("remote in my country") is listed
 * before the broader one ("remote, eligible from anywhere") — exactly the legacy P2-before-P1 precedence.
 */
const THREE_TIERS = (labels: [string, string, string], hybridTags: string[] = ['mnc', 'big_tech', 'anchor']): Preferences['tiers'] => [
  { id: 'tier2', label: labels[1], enabled: true, instant: true, points: 30, when: { workMode: ['remote'], locationCountry: 'home' } },
  { id: 'tier1', label: labels[0], enabled: true, instant: true, points: 40, when: { workMode: ['remote'], eligibleForMe: true } },
  { id: 'tier3', label: labels[2], enabled: true, instant: false, points: 15, when: { workMode: ['hybrid'], locationMetro: 'home.metros', companyTag: hybridTags } },
]

export const SYSTEM_PRESETS: Array<{ name: string; description: string; doc: Preferences }> = [
  {
    name: 'legacy-india-remote',
    description: 'JobRadar v1–v4 behaviour: global remote open to India (P1), remote-in-India (P2), hybrid Delhi-NCR at MNCs (P3); INR pay bands; India-HQ companies excluded.',
    doc: {
      schemaVersion: 1,
      home: { country: 'IN', metros: ['delhi-ncr'], timezone: 'Asia/Kolkata', currency: 'INR' },
      work: { modes: ['remote', 'hybrid'], hybridMetros: 'home.metros', onsiteMetros: 'home.metros' },
      role: { targetTitles: [], categories: ['Backend', 'Full Stack', 'DevOps', 'AI/ML', 'Data'], seniority: ['senior', 'lead', 'staff', 'principal'], skills: LEGACY_SKILLS, employmentTypes: ['full_time', 'contract'] },
      pay: { floor: 3_000_000, currency: 'INR', bands: [{ min: 9_000_000, pts: 30 }, { min: 8_500_000, pts: 25 }, { min: 7_500_000, pts: 20 }, { min: 6_500_000, pts: 15 }, { min: 5_500_000, pts: 10 }], requireTransparency: false },
      companies: { excludeHqCountries: ['IN'], exclude: [], onlyTags: [] },
      tiers: THREE_TIERS(['Global remote', 'Remote in India', 'Hybrid in Delhi NCR']),
      feed: { defaultTiers: ['tier1', 'tier2', 'tier3'], hideEmploymentTypes: ['internship', 'part_time'], sort: 'newest' },
      alerts: { digestHour: 8, quietHours: null },
    },
  },
  {
    name: 'us-remote',
    description: 'Remote roles open to US-based candidates; hybrid in your metros at any company; USD bands.',
    doc: {
      schemaVersion: 1,
      home: { country: 'US', metros: [], timezone: 'America/New_York', currency: 'USD' },
      work: { modes: ['remote', 'hybrid'], hybridMetros: 'home.metros', onsiteMetros: 'home.metros' },
      role: { targetTitles: [], categories: [], seniority: [], skills: [], employmentTypes: ['full_time', 'contract'] },
      pay: { floor: null, currency: 'USD', bands: [{ min: 250_000, pts: 30 }, { min: 200_000, pts: 25 }, { min: 160_000, pts: 20 }, { min: 130_000, pts: 15 }, { min: 100_000, pts: 10 }], requireTransparency: false },
      companies: { excludeHqCountries: [], exclude: [], onlyTags: [] },
      tiers: THREE_TIERS(['Remote (US eligible)', 'Remote in the US', 'Hybrid near me'], []),
      feed: { defaultTiers: ['tier1', 'tier2', 'tier3'], hideEmploymentTypes: ['internship', 'part_time'], sort: 'newest' },
      alerts: { digestHour: 8, quietHours: null },
    },
  },
  {
    name: 'eu-remote',
    description: 'Remote roles open to EU/EEA-based candidates; hybrid in your metros; EUR bands.',
    doc: {
      schemaVersion: 1,
      home: { country: 'DE', metros: [], timezone: 'Europe/Berlin', currency: 'EUR' },
      work: { modes: ['remote', 'hybrid'], hybridMetros: 'home.metros', onsiteMetros: 'home.metros' },
      role: { targetTitles: [], categories: [], seniority: [], skills: [], employmentTypes: ['full_time', 'contract'] },
      pay: { floor: null, currency: 'EUR', bands: [{ min: 140_000, pts: 30 }, { min: 120_000, pts: 25 }, { min: 100_000, pts: 20 }, { min: 85_000, pts: 15 }, { min: 70_000, pts: 10 }], requireTransparency: false },
      companies: { excludeHqCountries: [], exclude: [], onlyTags: [] },
      tiers: THREE_TIERS(['Remote (EU eligible)', 'Remote in my country', 'Hybrid near me'], []),
      feed: { defaultTiers: ['tier1', 'tier2', 'tier3'], hideEmploymentTypes: ['internship', 'part_time'], sort: 'newest' },
      alerts: { digestHour: 8, quietHours: null },
    },
  },
  {
    name: 'hybrid-metro',
    description: 'Prefer hybrid/onsite in your metros (any company), remote as a fallback.',
    doc: {
      schemaVersion: 1,
      home: { country: 'IN', metros: ['bengaluru'], timezone: 'Asia/Kolkata', currency: 'INR' },
      work: { modes: ['hybrid', 'onsite', 'remote'], hybridMetros: 'home.metros', onsiteMetros: 'home.metros' },
      role: { targetTitles: [], categories: [], seniority: [], skills: [], employmentTypes: ['full_time'] },
      pay: { floor: null, currency: 'INR', bands: [], requireTransparency: false },
      companies: { excludeHqCountries: [], exclude: [], onlyTags: [] },
      tiers: [
        { id: 'tier1', label: 'Hybrid near me', enabled: true, instant: true, points: 40, when: { workMode: ['hybrid'], locationMetro: 'home.metros' } },
        { id: 'tier2', label: 'Onsite near me', enabled: true, instant: true, points: 30, when: { workMode: ['onsite'], locationMetro: 'home.metros' } },
        { id: 'tier3', label: 'Remote in my country', enabled: true, instant: false, points: 15, when: { workMode: ['remote'], locationCountry: 'home' } },
      ],
      feed: { defaultTiers: ['tier1', 'tier2', 'tier3'], hideEmploymentTypes: ['internship', 'part_time'], sort: 'newest' },
      alerts: { digestHour: 8, quietHours: null },
    },
  },
]

/** The owner's doc from the pre-v5 env constants — used once by the seed so the upgrade changes nothing. */
export function legacyDocFromEnv(env: NodeJS.ProcessEnv = process.env): Preferences {
  const base = structuredClone(SYSTEM_PRESETS[0].doc)
  const floor = parseFloat(env.PAY_FLOOR_INR ?? '')
  if (Number.isFinite(floor)) base.pay.floor = floor
  const instant = (env.INSTANT_ALERT_CLASSES ?? 'p1_global_remote,p2_india_remote').split(',').map((s) => s.trim())
  const map: Record<string, string> = { p1_global_remote: 'tier1', p2_india_remote: 'tier2', p3_ncr_hybrid: 'tier3' }
  for (const t of base.tiers) t.instant = instant.map((c) => map[c] ?? c).includes(t.id)
  const cities = env.NCR_CITIES
  if (cities && !/gurugram|gurgaon|noida|delhi/i.test(cities)) base.home.metros = [] // a custom city list that is not NCR: the user picks metros in the editor
  const skills = (env.USER_TARGET_SKILLS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (skills.length) base.role.skills = skills
  return base
}

/** Legacy opportunity classes ↔ default tier ids (alert channel rows and old API clients). */
export const LEGACY_CLASS_TO_TIER: Record<string, string> = { p1_global_remote: 'tier1', p2_india_remote: 'tier2', p3_ncr_hybrid: 'tier3', none: 'none' }
export const TIER_TO_LEGACY_CLASS: Record<string, string> = { tier1: 'p1_global_remote', tier2: 'p2_india_remote', tier3: 'p3_ncr_hybrid', none: 'none' }
