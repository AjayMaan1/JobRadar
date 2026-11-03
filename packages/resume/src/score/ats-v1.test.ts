import { describe, expect, it } from 'vitest'
import { analyzeJdDeterministic } from '../jd/index.js'
import { quickMatch, scoreResume } from './ats-v1.js'
import { ResumeContentSchema } from '../schema/resume.js'
import { SAMPLE_JD, SAMPLE_JD_TITLE, SAMPLE_RESUME } from '../__fixtures__/sample.js'
import { profileFromResume } from '../profile/seed.js'

const reqs = analyzeJdDeterministic(SAMPLE_JD_TITLE, SAMPLE_JD)

describe('ats-v1 golden', () => {
  it('pins the score and breakdown for the sample resume × JD (change deliberately, bump SCORER_VERSION)', () => {
    const r = scoreResume(SAMPLE_RESUME, reqs, [])
    expect(r.scorerVersion).toBe('ats-v1')
    expect(Object.fromEntries(Object.entries(r.components).map(([k, c]) => [k, c.points]))).toEqual({
      requiredSkills: 24,
      preferredSkills: 9,
      title: 12,
      experience: 10,
      parseability: 15,
      quality: 10,
      keywords: 3,
    })
    expect(r.score).toBe(83)
    expect(r.missing.filter((m) => m.required).map((m) => m.skill).sort()).toEqual(['Amazon RDS', 'Communication', 'Grafana', 'Observability', 'Prometheus'])
    expect(r.matched.find((m) => m.skill === 'Go')!.where).toBe('experience')
    expect(r.matched.find((m) => m.skill === 'Python')!.where).toBe('skills')
    expect(r.matched.find((m) => m.skill === 'FinTech')!.where).toBe('experience') // "payments team" bullet
  })
  it('evidence in experience outweighs a bare skills list', () => {
    const listOnly = ResumeContentSchema.parse({ ...SAMPLE_RESUME, work: SAMPLE_RESUME.work.map((w) => ({ ...w, highlights: ['Did things'], keywords: [] })) })
    const a = scoreResume(SAMPLE_RESUME, reqs).components.requiredSkills.points
    const b = scoreResume(listOnly, reqs).components.requiredSkills.points
    expect(b).toBeLessThan(a)
  })
  it('alternative groups: Go OR Java satisfied by either', () => {
    const javaOnly = ResumeContentSchema.parse({ ...SAMPLE_RESUME, work: [{ name: 'X', position: 'Backend Engineer', startDate: '2018-01', highlights: ['Built Java services'] }], skills: [] })
    const r = scoreResume(javaOnly, reqs)
    expect(r.missing.map((m) => m.skill)).not.toContain('Go')
    expect(r.matched.filter((m) => m.group).length).toBe(1)
  })
  it('parse warnings reduce parseability; stuffing and first person reduce quality', () => {
    const r = scoreResume(SAMPLE_RESUME, reqs, [{ code: 'multi_column', severity: 'warn', message: '', penalty: 4 }, { code: 'tables', severity: 'warn', message: '', penalty: 3 }])
    expect(r.components.parseability.points).toBe(8)
    const stuffed = ResumeContentSchema.parse({ ...SAMPLE_RESUME, skills: [{ name: 'All', keywords: Array.from({ length: 45 }, (_, i) => `Tool${i}`) }], work: [{ ...SAMPLE_RESUME.work[0], highlights: ['I used Go Go Go Go Go Go Go every day'] }] })
    const s = scoreResume(stuffed, reqs)
    expect(s.details.stuffing.length).toBeGreaterThan(0)
    expect(s.components.quality.points).toBeLessThan(r.components.quality.points)
  })
  it('experience component compares years with the JD minimum', () => {
    const junior = ResumeContentSchema.parse({ ...SAMPLE_RESUME, work: [{ ...SAMPLE_RESUME.work[0], startDate: '2023-01' }] })
    expect(scoreResume(junior, reqs).components.experience.points).toBeLessThanOrEqual(4)
    expect(scoreResume(SAMPLE_RESUME, { ...reqs, yearsMin: null }).components.experience.points).toBe(7)
  })
  it('score is deterministic', () => {
    expect(scoreResume(SAMPLE_RESUME, reqs)).toEqual(scoreResume(SAMPLE_RESUME, reqs))
  })
})

describe('profile seed + quick match', () => {
  it('seeds headline/about/skills/years/titles from the master resume', () => {
    const p = profileFromResume(SAMPLE_RESUME)
    expect(p.headline).toBe('Senior Software Engineer')
    expect(p.about).toContain('Backend engineer')
    expect(p.targetTitles).toEqual(['Senior Software Engineer', 'Software Engineer'])
    const byName = Object.fromEntries(p.skills.map((s) => [s.canonical, s.source]))
    expect(byName.Go).toBe('both')
    expect(byName.Python).toBe('skills')
    expect(byName.gRPC).toBe('experience')
    expect(p.yearsExperience).toBeGreaterThan(7)
  })
  it('quick match is a weighted overlap of profile skills and job text', () => {
    const skills = profileFromResume(SAMPLE_RESUME).skills.map((s) => s.canonical)
    const m = quickMatch(skills, SAMPLE_JD_TITLE, SAMPLE_JD)
    expect(m).toBeGreaterThan(50)
    expect(quickMatch([], 'x', 'Go')).toBeNull()
    expect(quickMatch(['Go'], 'Receptionist', 'Answer phones')).toBeNull()
  })
})
