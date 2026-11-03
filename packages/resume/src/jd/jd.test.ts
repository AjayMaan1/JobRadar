import { describe, expect, it } from 'vitest'
import { FakeLlmProvider } from '@jobradar/llm'
import { analyzeJd, analyzeJdDeterministic, extractYearsMin, normalizeTitle, sectionize } from './index.js'
import { SAMPLE_JD, SAMPLE_JD_TITLE } from '../__fixtures__/sample.js'

describe('jd-v1 deterministic', () => {
  it('sections a structured JD by headings; bullet lines are never headings', () => {
    const s = sectionize(SAMPLE_JD)
    expect(s.headingsFound).toBe(6)
    expect(s.buckets.required).toHaveLength(5)
    expect(s.buckets.preferred).toHaveLength(3) // "…is a plus" bullet stays content
    expect(s.buckets.responsibilities).toHaveLength(5)
  })
  it('golden: required/preferred/years/title/seniority (pin — change deliberately)', () => {
    const r = analyzeJdDeterministic(SAMPLE_JD_TITLE, SAMPLE_JD)
    expect(r.titleNormalized).toBe('backend engineer')
    expect(r.seniority).toBe('senior')
    expect(r.yearsMin).toBe(6)
    const req = Object.fromEntries(r.required.map((x) => [x.skill, x.weight]))
    expect(req).toEqual({
      'Amazon EKS': 1, 'Amazon RDS': 1, AWS: 1, Communication: 1, Go: 1, Java: 1, Kafka: 1, PostgreSQL: 1,
      'Event-Driven Architecture': 0.8, Grafana: 0.8, gRPC: 0.8, Kubernetes: 0.8, Mentoring: 0.8, Observability: 0.8, Prometheus: 0.8, 'REST APIs': 0.8,
    })
    expect(r.preferred.map((x) => x.skill).sort()).toEqual(['FinTech', 'Python', 'Terraform'])
    // "Go or Java" → alternative group
    const go = r.required.find((x) => x.skill === 'Go')!, java = r.required.find((x) => x.skill === 'Java')!
    expect(go.group).toBeDefined()
    expect(go.group).toBe(java.group)
    // benefits-section mention of Kubernetes does not promote it
    expect(req.Kubernetes).toBe(0.8)
  })
  it('unstructured JD: everything is required at 0.7', () => {
    const r = analyzeJdDeterministic('Platform Engineer', 'We need someone who knows Terraform and AWS really well. Python scripting daily. 3 years experience minimum.')
    expect(r.required.map((x) => `${x.skill}:${x.weight}`).sort()).toEqual(['AWS:0.7', 'Python:0.7', 'Terraform:0.7'])
    expect(r.yearsMin).toBe(3)
  })
  it('helpers', () => {
    expect(normalizeTitle('Sr. Staff Front-End Developer II (Remote, US)')).toBe('front-end developer')
    expect(extractYearsMin('8+ years of experience building APIs, 2+ years with Go')).toBe(8)
    expect(extractYearsMin('3-5 years of relevant experience')).toBe(3)
    expect(extractYearsMin('founded 5 years ago; 10 years in the market')).toBeNull()
  })
})

describe('jd-v1 with LLM refinement', () => {
  it('merges LLM additions without overriding deterministic evidence; falls back on failure', async () => {
    const llm = new FakeLlmProvider().on('analyze_jd', () => ({
      required: [{ skill: 'Kubernetes', weight: 1 }, { skill: 'Temporal', weight: 0.9 }, { skill: 'golang', weight: 1 }],
      preferred: [{ skill: 'Rust', weight: 0.3 }],
      keywords: [{ term: 'payments', weight: 0.8 }, { term: 'on-call', weight: 0.4 }],
      yearsMin: 5, seniority: 'lead', titleNormalized: 'backend engineer',
    }))
    const r = await analyzeJd(SAMPLE_JD_TITLE, SAMPLE_JD, llm)
    expect(r.llmUsed).toBe(true)
    expect(r.required.find((x) => x.skill === 'Kubernetes')!.weight).toBe(0.8) // deterministic wins
    expect(r.required.find((x) => x.skill === 'Temporal')).toMatchObject({ weight: 0.8, source: 'llm' }) // capped
    expect(r.required.filter((x) => x.skill === 'Go')).toHaveLength(1) // canonicalised, not duplicated
    expect(r.preferred.map((x) => x.skill)).toContain('Rust')
    expect(r.keywords.map((k) => k.term)).toEqual(['payments', 'on-call'])
    expect(r.yearsMin).toBe(6) // deterministic value kept
    expect(r.seniority).toBe('senior')

    const failing = new FakeLlmProvider().on('analyze_jd', () => { throw new Error('boom') })
    const f = await analyzeJd(SAMPLE_JD_TITLE, SAMPLE_JD, failing)
    expect(f.llmUsed).toBe(false)
  })
})
