import { describe, expect, it } from 'vitest'
import { adapterForSource, availabilityIssueForSource, SUPERSEDED_DOMAINS } from './source-registry.js'

const base = { id: 'x', refreshIntervalHours: 8, qualityScore: 50, ingestionMethod: 'api' }

describe('source registry (single adapter map shared by worker + web)', () => {
  it('resolves dedicated adapters by exact domain', () => {
    expect(adapterForSource({ ...base, name: 'Remotive', domain: 'remotive.io' })?.sourceName).toBe('Remotive')
    expect(adapterForSource({ ...base, name: 'Arc', domain: 'arc.dev' })?.sourceName).toBe('Arc.dev')
  })

  it('resolves company ATS domains by suffix', () => {
    expect(adapterForSource({ ...base, name: 'NVIDIA', domain: 'nvidia.wd5.myworkdayjobs.com', ingestionMethod: 'ats_workday' })?.sourceName).toBe('Workday')
  })

  it('no longer falls back to the heuristic link scraper for adapter-less Playwright sources', () => {
    const issue = availabilityIssueForSource({ ...base, name: 'Otta', domain: 'otta.com', ingestionMethod: 'scrape_playwright', careersUrl: 'https://app.otta.com/jobs' })
    expect(issue).toBe('No adapter for domain: otta.com')
  })

  it('marks multi-company ATS crawls as superseded by company boards', () => {
    expect(SUPERSEDED_DOMAINS.has('boards.greenhouse.io')).toBe(true)
    expect(availabilityIssueForSource({ ...base, name: 'Greenhouse ATS', domain: 'boards.greenhouse.io', ingestionMethod: 'ats_greenhouse' })).toMatch(/Superseded/)
    expect(adapterForSource({ ...base, name: 'Greenhouse ATS', domain: 'boards.greenhouse.io' })).toBeUndefined()
  })

  it('reports missing adapters for unknown domains', () => {
    expect(availabilityIssueForSource({ ...base, name: 'Unknown', domain: 'unknown.example' })).toBe('No adapter for domain: unknown.example')
  })

  it('surfaces adapter-level availability issues (Wellfound anti-bot)', () => {
    expect(availabilityIssueForSource({ ...base, name: 'Wellfound', domain: 'wellfound.com', ingestionMethod: 'scrape_playwright' })).toMatch(/DataDome/)
  })
})
