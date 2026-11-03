import { describe, expect, it } from 'vitest'
import { classifyOpportunity, detectEmploymentType } from '../classifier.js'
import { extractJobFacts, eligibleFor, parseLocations } from './facts.js'
import { coversCountry } from './dictionary.js'

const us = { hqCountry: 'US', tags: [] as string[] }
const mnc = { hqCountry: 'US', tags: ['mnc', 'big_tech'] }
const base = { title: 'Senior Software Engineer', description: '', remoteType: 'remote' as const, company: us }

/** Legacy P1/P2/P3 expressed over facts (what the `legacy-india-remote` preset evaluates to). */
function legacyTier(input: Parameters<typeof classifyOpportunity>[0]): string {
  const f = extractJobFacts({ ...input, employmentType: detectEmploymentType(input.title, input.description) })
  if (f.company.hqCountry === 'IN') return 'none'
  if (f.workMode === 'remote') {
    if (f.locations.some((l) => l.country === 'IN')) return 'p2_india_remote'
    return eligibleFor(f, 'IN', 5.5).eligible ? 'p1_global_remote' : 'none'
  }
  if (f.workMode === 'hybrid' && f.locations.some((l) => l.metro === 'delhi-ncr') && f.company.tags.some((t) => ['mnc', 'big_tech', 'anchor'].includes(t))) return 'p3_ncr_hybrid'
  return 'none'
}

const CASES: Array<Parameters<typeof classifyOpportunity>[0]> = [
  ...['Remote, Worldwide', 'Remote - Anywhere', 'Remote (APAC)', 'Remote'].map((location) => ({ ...base, location })),
  { ...base, location: 'Remote', description: 'We hire via Deel in any country.' },
  { ...base, location: 'Remote', description: 'Need 4h overlap with CET.' },
  { ...base, location: 'Remote', description: 'Timezone UTC+5:30 preferred.' },
  { ...base, location: 'Berlin', remoteType: 'unknown', isRemoteFlag: true },
  ...([['Remote (US)', ''], ['Remote - US', ''], ['Remote - EU only', ''], ['Remote', 'Must be based in the United States.'], ['Remote', 'Right to work in the UK required.'], ['Remote', 'US work authorization required.'], ['Remote', 'Candidates must be located in Germany.'], ['Remote', 'We are only able to hire in the US and Canada.'], ['Remote', 'Within US time zones only.']] as const).map(([location, description]) => ({ ...base, location, description })),
  { ...base, location: 'Remote (US)', description: 'We are a global company, worldwide presence.' },
  ...['Remote - India', 'India (Remote)', 'Bengaluru, India - Remote', 'Remote, IST'].map((location) => ({ ...base, location })),
  { ...base, remoteType: 'hybrid', location: 'Gurugram, Haryana, India', company: mnc },
  { ...base, remoteType: 'hybrid', location: 'Noida, India', company: mnc },
  { ...base, remoteType: 'onsite', location: 'Gurugram, India', company: mnc },
  { ...base, remoteType: 'hybrid', location: 'Bengaluru, India', company: mnc },
  { ...base, remoteType: 'hybrid', location: 'Gurugram, India', company: us },
  { ...base, location: 'Remote, Worldwide', company: { hqCountry: 'IN', tags: [] } },
  { ...base, location: 'Remote, Worldwide', company: null },
  { ...base, location: 'Remote', description: 'Remote (EMEA only). Must be based in the EU.' },
  { ...base, location: 'Remote', description: 'Open to candidates in LATAM.' },
  { ...base, location: 'Remote - EMEA', description: '' },
  { ...base, location: 'Remote', description: 'Fully remote team, we are globally distributed, no sponsorship for US roles.' },
]

describe('job facts reproduce the legacy classifier (golden gate, HLD §4)', () => {
  it('every classifier fixture maps to the same tier through facts + legacy preset', () => {
    const diffs: string[] = []
    for (const c of CASES) {
      const legacy = classifyOpportunity(c).opportunityClass
      const viaFacts = legacyTier(c)
      if (legacy !== viaFacts) diffs.push(`${c.location} | ${c.description.slice(0, 40)} → legacy ${legacy} vs facts ${viaFacts}`)
    }
    expect(diffs, diffs.join('\n')).toEqual([])
  })
})

describe('structured geo facts', () => {
  it('parses location lines into country / metro / region', () => {
    expect(parseLocations('Gurugram, Haryana, India')[0]).toMatchObject({ metro: 'delhi-ncr', country: 'IN' })
    expect(parseLocations('Remote - EMEA')).toEqual(expect.arrayContaining([expect.objectContaining({ region: 'EMEA' })]))
    expect(parseLocations('London, UK or Berlin, Germany').map((l) => l.metro)).toEqual(['london', 'berlin'])
    expect(parseLocations('San Francisco, CA (Hybrid)')[0]).toMatchObject({ metro: 'sf-bay-area', country: 'US' })
  })
  it('restriction phrases become exclusive allow lists and eligibility is per country', () => {
    const f = extractJobFacts({ ...base, location: 'Remote', description: 'We are only able to hire in the US and Canada.', employmentType: 'full_time' })
    expect(f.geo.restrict.sort()).toEqual(['CA', 'US'])
    expect(eligibleFor(f, 'US').eligible).toBe(true)
    expect(eligibleFor(f, 'CA').eligible).toBe(true)
    expect(eligibleFor(f, 'IN').eligible).toBe(false)
    expect(eligibleFor(f, 'DE').eligible).toBe(false)
  })
  it('region restrictions expand to member countries', () => {
    const f = extractJobFacts({ ...base, location: 'Remote - EU only', employmentType: 'full_time' })
    expect(eligibleFor(f, 'DE').eligible).toBe(true)
    expect(eligibleFor(f, 'GB').eligible).toBe(false) // UK ∉ EU
    expect(eligibleFor(f, 'IN').eligible).toBe(false)
    expect(coversCountry(['EMEA'], 'GB')).toBe(true)
  })
  it('timezone windows are evaluated against the candidate offset', () => {
    const f = extractJobFacts({ ...base, location: 'Remote', description: 'Within US time zones only.', employmentType: 'full_time' })
    expect(f.geo.tzWindow).toBeTruthy()
    expect(eligibleFor(f, 'US', -6).eligible).toBe(true)
    expect(eligibleFor(f, 'MX', -6).eligible).toBe(true)
    expect(eligibleFor(f, 'IN', 5.5).eligible).toBe(false)
    const g = extractJobFacts({ ...base, location: 'Remote', description: 'Need 4h overlap with CET.', employmentType: 'full_time' })
    expect(eligibleFor(g, 'IN', 5.5).eligible).toBe(true)
    expect(eligibleFor(g, 'US', -8).eligible).toBe(false)
  })
  it('worldwide beats a body restriction; location-line restriction beats everything', () => {
    const ok = extractJobFacts({ ...base, location: 'Remote', description: 'Work from anywhere. No sponsorship for US roles.', employmentType: 'full_time' })
    expect(eligibleFor(ok, 'IN').eligible).toBe(true)
    const no = extractJobFacts({ ...base, location: 'Remote (US)', description: 'We are a global company, worldwide presence.', employmentType: 'full_time' })
    expect(eligibleFor(no, 'IN').eligible).toBe(false)
    expect(eligibleFor(no, 'US').eligible).toBe(true)
  })
  it('salary carries a USD pivot', () => {
    const f = extractJobFacts({ ...base, location: 'Remote', employmentType: 'full_time', salary: { min: 100_000, max: 150_000, currency: 'EUR', period: 'year' } })
    expect(f.salary?.usdMin).toBe(108_000)
    expect(f.salary?.usdMax).toBe(162_000)
  })
})
