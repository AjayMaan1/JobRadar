import { describe, expect, it } from 'vitest'
import { expandQuery } from './synonyms.js'

describe('search fallback: role synonym expansion (no embedding model needed)', () => {
  it('expands software-dev role queries', () => {
    const t = expandQuery('software engineer').terms
    expect(t[0]).toBe('software engineer')
    expect(t).toEqual(expect.arrayContaining(['software developer', 'software development engineer', 'sde', 'swe']))
    expect(t).not.toContain('sdet') // QA group must not bleed in
    expect(expandQuery('AI Engineer').terms).toEqual(expect.arrayContaining(['machine learning engineer', 'ml engineer', 'llm engineer']))
    expect(expandQuery('software development eng').terms).toContain('software engineer') // unfinished word
  })
  it('strips seniority and expands skill aliases; leaves unknown terms alone', () => {
    expect(expandQuery('Senior Backend Engineer').terms).toEqual(expect.arrayContaining(['backend engineer', 'back-end engineer', 'backend developer']))
    expect(expandQuery('k8s').terms).toContain('Kubernetes')
    expect(expandQuery('Acme').terms).toEqual(['Acme'])
    expect(expandQuery('').terms).toEqual([])
    expect(expandQuery('software engineer').terms.length).toBeLessThanOrEqual(14)
  })
})
