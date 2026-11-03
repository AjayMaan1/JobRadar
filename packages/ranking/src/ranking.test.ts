import { describe, expect, it } from 'vitest'
import { RankingService } from './ranking.service.js'
import { scoreFreshness } from './scorers/freshness.scorer.js'
import { CLASS_BAND } from './scorers/class.scorer.js'

const svc = new RankingService({} as any)
const job = (o: Record<string, unknown> = {}) => ({ opportunityClass: 'p1_global_remote', employmentType: 'full_time', salaryInrMin: null, salaryMin: null, salaryMax: null, skills: '[]', category: null, seniority: null, sourceName: 's', firstSeenAt: new Date(), postedAt: null, discoveredAt: new Date(), baseScore: 0, ...o }) as any

describe('ranking v2', () => {
  it('class band dominates: P1 40 > P2 30 > P3 15 > none 0', () => {
    expect(CLASS_BAND).toEqual({ p1_global_remote: 40, p2_india_remote: 30, p3_ncr_hybrid: 15, none: 0 })
    const b = (c: string) => svc.computeBase(job({ opportunityClass: c }), 50).base
    expect(b('p1_global_remote')).toBeGreaterThan(b('p2_india_remote'))
    expect(b('p2_india_remote')).toBeGreaterThan(b('p3_ncr_hybrid'))
    expect(b('p3_ncr_hybrid')).toBeGreaterThan(b('none'))
  })
  it('no salary does not block a high score (alerts no longer depend on score)', () => {
    const b = svc.computeBase(job(), 85)
    expect(b.compensation).toBe(0)
    expect(b.base).toBeGreaterThanOrEqual(40)
  })
  it('compensation bands from INR', () => {
    expect(svc.computeBase(job({ salaryInrMin: 9_500_000, salaryMin: 1, salaryMax: 2 }), 50).compensation).toBe(30)
    expect(svc.computeBase(job({ salaryInrMin: 5_600_000, salaryMin: 1, salaryMax: 2 }), 50).compensation).toBe(10)
  })
  it('freshness decays from first_seen_at at read time', () => {
    const h = (hours: number) => scoreFreshness({ firstSeenAt: new Date(Date.now() - hours * 3600_000), postedAt: null, discoveredAt: new Date() } as any)
    expect(h(0.5)).toBe(10); expect(h(5)).toBe(9); expect(h(20)).toBe(7); expect(h(50)).toBe(4); expect(h(100)).toBe(2); expect(h(500)).toBe(0)
    expect(RankingService.displayScore(job({ baseScore: 60, firstSeenAt: new Date() }))).toBe(70)
  })
  it('quality maps 0..100 → 0..5 with a default of 50', () => {
    expect(svc.computeBase(job(), null).sourceQuality).toBe(3)
    expect(svc.computeBase(job(), 100).sourceQuality).toBe(5)
  })
})

describe('role fit from profile (C5-7)', () => {
  it('uses profile skills/titles when given, RANKING_CONFIG otherwise', async () => {
    const j = job({ skills: JSON.stringify(['Elixir', 'Phoenix']), title: 'Senior Elixir Engineer', category: null, seniority: 'senior' })
    expect(svc.computeBase(j, 50).roleFit).toBe(3) // seniority only under static config
    const prefs = { targetSkills: ['Elixir', 'Phoenix'], preferredCategories: [], preferredSeniority: ['senior'], targetTitles: ['Elixir Engineer'] }
    expect(svc.computeBase(j, 50, prefs).roleFit).toBe(4 + 4 + 3)
  })
  it('falls back to RANKING_CONFIG when no profile row exists', async () => {
    const s = new RankingService({ user: { count: async () => 1 }, candidateProfile: { findFirst: async () => null } } as any)
    expect((await s.prefs()).targetSkills.length).toBeGreaterThan(10)
  })
  it('single user: the profile drives the global base score', async () => {
    const profile = { skills: [{ canonical: 'Elixir' }], targetTitles: ['Elixir Engineer'] }
    const s = new RankingService({ user: { count: async () => 1 }, candidateProfile: { findFirst: async () => profile } } as any)
    expect((await s.prefs()).targetSkills).toEqual(['Elixir'])
  })
  it('multi-user (audit NEW-03): no single profile may reorder the shared feed', async () => {
    const profile = { skills: [{ canonical: 'Elixir' }], targetTitles: ['Elixir Engineer'] }
    const s = new RankingService({ user: { count: async () => 2 }, candidateProfile: { findFirst: async () => profile } } as any)
    expect((await s.prefs()).targetSkills).not.toEqual(['Elixir'])
    expect((await s.prefs()).targetSkills.length).toBeGreaterThan(10)
  })
})
