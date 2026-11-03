import { describe, expect, it } from 'vitest'
import { ResumeContentSchema, experienceText, parseResumeDate, resumeText, yearsOfExperience } from './resume.js'
import { SAMPLE_RESUME } from '../__fixtures__/sample.js'

describe('resume schema', () => {
  it('fills defaults and validates dates', () => {
    const c = ResumeContentSchema.parse({ basics: { name: 'X' }, work: [{ name: 'A', position: 'B', startDate: '2020-03' }] })
    expect(c.work[0].highlights).toEqual([])
    expect(c.skills).toEqual([])
    expect(() => ResumeContentSchema.parse({ work: [{ startDate: 'March 2020' }] })).toThrow()
  })
  it('years of experience merges overlapping roles', () => {
    const now = Date.UTC(2025, 0, 1)
    expect(yearsOfExperience(SAMPLE_RESUME, now)).toBe(7.5) // 2017-06→2019-12 (2.5) + 2020-01→2025-01 (5)
    const overlapping = ResumeContentSchema.parse({ work: [{ startDate: '2020-01', endDate: '2022-01' }, { startDate: '2021-01', endDate: '2023-01' }] })
    expect(yearsOfExperience(overlapping, now)).toBe(3)
    expect(parseResumeDate('')).toBeNull()
  })
  it('text views separate experience from the skills list', () => {
    expect(experienceText(SAMPLE_RESUME)).toContain('Mentored 3 junior engineers')
    expect(experienceText(SAMPLE_RESUME)).not.toContain('Python')
    expect(resumeText(SAMPLE_RESUME)).toContain('Python')
  })
})
