import { describe, expect, it } from 'vitest'
import { classifyOpportunity, detectEmploymentType, extractJobFacts } from '@jobradar/extractor'
import { evaluate } from './evaluate.js'
import { SYSTEM_PRESETS, TIER_TO_LEGACY_CLASS, legacyDocFromEnv } from './presets.js'
import { parsePreferences } from './schema.js'

const legacy = parsePreferences(SYSTEM_PRESETS[0].doc)
const us = { hqCountry: 'US', tags: [] as string[] }
const mnc = { hqCountry: 'US', tags: ['mnc', 'big_tech'] }
const base = { title: 'Senior Software Engineer', description: '', remoteType: 'remote' as const, company: us }

const job = (input: Parameters<typeof classifyOpportunity>[0], extra: Partial<Parameters<typeof extractJobFacts>[0]> = {}) => ({
  title: input.title,
  company: 'Acme',
  quality: 60,
  facts: extractJobFacts({ ...input, employmentType: detectEmploymentType(input.title, input.description), ...extra }),
})

describe('evaluate × legacy preset reproduces the v1–v4 classifier (golden gate)', () => {
  const cases: Array<Parameters<typeof classifyOpportunity>[0]> = [
    ...['Remote, Worldwide', 'Remote - Anywhere', 'Remote (APAC)', 'Remote'].map((location) => ({ ...base, location })),
    { ...base, location: 'Remote', description: 'We hire via Deel in any country.' },
    { ...base, location: 'Remote', description: 'Need 4h overlap with CET.' },
    { ...base, location: 'Berlin', remoteType: 'unknown', isRemoteFlag: true },
    ...([['Remote (US)', ''], ['Remote - EU only', ''], ['Remote', 'Must be based in the United States.'], ['Remote', 'Within US time zones only.']] as const).map(([location, description]) => ({ ...base, location, description })),
    ...['Remote - India', 'India (Remote)', 'Bengaluru, India - Remote', 'Remote, IST'].map((location) => ({ ...base, location })),
    { ...base, remoteType: 'hybrid', location: 'Gurugram, Haryana, India', company: mnc },
    { ...base, remoteType: 'onsite', location: 'Gurugram, India', company: mnc },
    { ...base, remoteType: 'hybrid', location: 'Bengaluru, India', company: mnc },
    { ...base, remoteType: 'hybrid', location: 'Gurugram, India', company: us },
    { ...base, location: 'Remote, Worldwide', company: { hqCountry: 'IN', tags: [] } },
    { ...base, location: 'Remote, Worldwide', company: null },
  ]
  it('same class for every fixture', () => {
    const diffs = cases.map((c) => [classifyOpportunity(c).opportunityClass, TIER_TO_LEGACY_CLASS[evaluate(job(c), legacy).tier]] as const).filter(([a, b]) => a !== b)
    expect(diffs).toEqual([])
  })
  it('score components mirror the legacy ranking bands', () => {
    const r = evaluate(job({ ...base, location: 'Remote, Worldwide' }, { skills: ['Go', 'Kafka', 'PostgreSQL'], seniority: 'senior', category: 'Backend', salary: { min: 9_500_000, max: 12_000_000, currency: 'INR', period: 'year' } }), legacy)
    expect(r.tier).toBe('tier1')
    expect(r.components).toEqual({ tier: 40, pay: 30, roleFit: 6 + 4 + 3, transparency: 5, sourceQuality: 3 })
    expect(r.score).toBe(91)
    expect(r.reasons).toEqual(expect.arrayContaining(['pay band +30', 'skills: Go, Kafka, PostgreSQL']))
  })
})

describe('evaluate is per user', () => {
  it('a US-only posting is tier1 for a US preset and excluded-by-eligibility for the India preset', () => {
    const usPrefs = parsePreferences(SYSTEM_PRESETS.find((p) => p.name === 'us-remote')!.doc)
    const j = job({ ...base, location: 'Remote - US' })
    expect(evaluate(j, usPrefs).tier).toBe('tier2')       // remote + location names the US → "Remote in the US"
    expect(evaluate(j, legacy).tier).toBe('none')
    expect(evaluate(j, legacy).eligible).toBe(false)
  })
  it('hybrid metros and company tags follow the document', () => {
    const hybrid = parsePreferences({ ...SYSTEM_PRESETS.find((p) => p.name === 'hybrid-metro')!.doc, home: { country: 'IN', metros: ['bengaluru'], timezone: 'Asia/Kolkata', currency: 'INR' } })
    expect(evaluate(job({ ...base, remoteType: 'hybrid', location: 'Bengaluru, India', company: us }), hybrid).tier).toBe('tier1')
    expect(evaluate(job({ ...base, remoteType: 'hybrid', location: 'Gurugram, India', company: mnc }), hybrid).tier).toBe('none')
  })
  it('pay floor and employment type exclusions are explained', () => {
    const r = evaluate(job({ ...base, location: 'Remote, Worldwide' }, { salary: { min: 1_500_000, max: 2_000_000, currency: 'INR', period: 'year' } }), legacy)
    expect(r.tier).toBe('none')
    expect(r.excluded).toMatch(/below pay floor/)
    const i = evaluate(job({ ...base, title: 'Software Engineering Intern', location: 'Remote, Worldwide' }), legacy)
    expect(i.excluded).toBe('employment type: internship')
  })
  it('pay bands convert through USD into the user currency', () => {
    const usPrefs = parsePreferences(SYSTEM_PRESETS.find((p) => p.name === 'us-remote')!.doc)
    const r = evaluate(job({ ...base, location: 'Remote, Worldwide' }, { salary: { min: 150_000, max: 180_000, currency: 'EUR', period: 'year' } }), usPrefs)
    expect(r.components.pay).toBe(20) // 150k EUR ≈ 162k USD → ≥ 160k band
  })
  it('legacyDocFromEnv honours PAY_FLOOR_INR and INSTANT_ALERT_CLASSES', () => {
    const d = legacyDocFromEnv({ PAY_FLOOR_INR: '4500000', INSTANT_ALERT_CLASSES: 'p1_global_remote' } as NodeJS.ProcessEnv)
    expect(d.pay.floor).toBe(4_500_000)
    expect(Object.fromEntries(d.tiers.map((t) => [t.id, t.instant]))).toEqual({ tier1: true, tier2: false, tier3: false })
  })
})
