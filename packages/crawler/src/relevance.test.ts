import { describe, expect, it } from 'vitest'
import { isRelevantRole } from './relevance.js'

describe('isRelevantRole (pre-extraction filter)', () => {
  it('keeps software engineering titles including one-word Backend/Frontend/Fullstack (regression)', () => {
    for (const t of ['Senior Backend Engineer, Ruby', 'Staff Frontend Engineer', 'Fullstack Developer', 'Platform Engineer', 'Founding Engineer', 'Data Scientist', 'Site Reliability Engineer', 'ML Engineer']) {
      expect(isRelevantRole(t)).toBe(true)
    }
  })
  it('drops non-engineering and non-software engineering roles', () => {
    for (const t of ['Marketing Manager', 'Sales Engineer', 'Mechanical Engineer', 'Customer Success Manager', 'Product Designer', 'Engineering Recruiter', 'Technical Recruiter']) {
      expect(isRelevantRole(t)).toBe(false)
    }
  })
  it('uses context for ambiguous titles', () => {
    expect(isRelevantRole('Scientist', [], 'PyTorch, Python, distributed training')).toBe(true)
    expect(isRelevantRole('Scientist', [], 'wet lab, PCR')).toBe(false)
  })
})
