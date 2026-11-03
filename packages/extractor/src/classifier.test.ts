import { describe, expect, it } from 'vitest'
import { classifyOpportunity, detectEmploymentType, isNcrLocation, findRestriction } from './classifier.js'

const us = { hqCountry: 'US', tags: [] as string[] }
const mnc = { hqCountry: 'US', tags: ['mnc', 'big_tech'] }
const base = { title: 'Senior Software Engineer', description: '', remoteType: 'remote' as const, company: us }

describe('classifyOpportunity — priority classes', () => {
  it('P1: remote + worldwide/anywhere/APAC/overlap/EOR signals', () => {
    for (const loc of ['Remote, Worldwide', 'Remote - Anywhere', 'Remote (APAC)', 'Remote']) {
      expect(classifyOpportunity({ ...base, location: loc }).opportunityClass).toBe('p1_global_remote')
    }
    expect(classifyOpportunity({ ...base, location: 'Remote', description: 'We hire via Deel in any country.' }).opportunityClass).toBe('p1_global_remote')
    expect(classifyOpportunity({ ...base, location: 'Remote', description: 'Need 4h overlap with CET.' }).opportunityClass).toBe('p1_global_remote')
    expect(classifyOpportunity({ ...base, location: 'Remote', description: 'Timezone UTC+5:30 preferred.' }).opportunityClass).toBe('p1_global_remote')
  })

  it('P1 uses the lever/ashby isRemote flag when the location line is a city', () => {
    expect(classifyOpportunity({ ...base, location: 'Berlin', remoteType: 'unknown', isRemoteFlag: true }).opportunityClass).toBe('p1_global_remote')
  })

  it('none: remote but restricted to US/EU/UK etc. (reason recorded)', () => {
    const cases = [
      ['Remote (US)', ''], ['Remote - US', ''], ['Remote - EU only', ''], ['Remote', 'Must be based in the United States.'],
      ['Remote', 'Right to work in the UK required.'], ['Remote', 'US work authorization required.'], ['Remote', 'Candidates must be located in Germany.'],
      ['Remote', 'We are only able to hire in the US and Canada.'], ['Remote', 'Within US time zones only.'],
    ]
    for (const [loc, desc] of cases) {
      const r = classifyOpportunity({ ...base, location: loc, description: desc })
      expect(r.opportunityClass).toBe('none')
      expect(r.reason).toMatch(/restricted/)
    }
  })

  it('restriction in the location line wins over an india-ok phrase in the body', () => {
    expect(classifyOpportunity({ ...base, location: 'Remote (US)', description: 'We are a global company, worldwide presence.' }).opportunityClass).toBe('none')
  })

  it('P2: remote with India in the location', () => {
    for (const loc of ['Remote - India', 'India (Remote)', 'Bengaluru, India - Remote', 'Remote, IST']) {
      expect(classifyOpportunity({ ...base, location: loc }).opportunityClass).toBe('p2_india_remote')
    }
  })

  it('P3: HYBRID only, Delhi-NCR, company tagged mnc/big_tech', () => {
    expect(classifyOpportunity({ ...base, remoteType: 'hybrid', location: 'Gurugram, Haryana, India', company: mnc }).opportunityClass).toBe('p3_ncr_hybrid')
    expect(classifyOpportunity({ ...base, remoteType: 'hybrid', location: 'Noida, India', company: mnc }).opportunityClass).toBe('p3_ncr_hybrid')
    // onsite → none (decision: hybrid only)
    expect(classifyOpportunity({ ...base, remoteType: 'onsite', location: 'Gurugram, India', company: mnc }).opportunityClass).toBe('none')
    // hybrid outside NCR → none
    expect(classifyOpportunity({ ...base, remoteType: 'hybrid', location: 'Bengaluru, India', company: mnc }).opportunityClass).toBe('none')
    // hybrid NCR but not an MNC → none
    expect(classifyOpportunity({ ...base, remoteType: 'hybrid', location: 'Gurugram, India', company: us }).opportunityClass).toBe('none')
  })

  it('india-HQ companies are excluded regardless of posting', () => {
    expect(classifyOpportunity({ ...base, location: 'Remote, Worldwide', company: { hqCountry: 'IN', tags: [] } })).toEqual({ opportunityClass: 'none', reason: 'india_hq' })
  })

  it('unknown HQ is allowed', () => {
    expect(classifyOpportunity({ ...base, location: 'Remote, Worldwide', company: null }).opportunityClass).toBe('p1_global_remote')
  })
})

describe('detectEmploymentType', () => {
  it('uses ATS hints first, then title, then description', () => {
    expect(detectEmploymentType('Engineer', '', ['Full-time'])).toBe('full_time')
    expect(detectEmploymentType('Engineer', '', ['Intern'])).toBe('internship')
    expect(detectEmploymentType('Software Engineer (Contract)', '')).toBe('contract')
    expect(detectEmploymentType('Engineer', 'This is a B2B contract role.', [])).toBe('contract')
    expect(detectEmploymentType('Part-time Developer', '')).toBe('part_time')
    expect(detectEmploymentType('Engineer', '')).toBe('unknown')
  })
})

describe('helpers', () => {
  it('isNcrLocation', () => {
    expect(isNcrLocation('Gurgaon, India')).toBe(true)
    expect(isNcrLocation('Greater Noida')).toBe(true)
    expect(isNcrLocation('New Delhi')).toBe(true)
    expect(isNcrLocation('Delhi NCR')).toBe(true)
    expect(isNcrLocation('Hyderabad')).toBe(false)
    expect(isNcrLocation(null)).toBe(false)
  })
  it('findRestriction returns the matched phrase', () => {
    expect(findRestriction('Remote - EU only')).toMatch(/EU only/i)
    expect(findRestriction('Remote worldwide')).toBeNull()
  })
})
