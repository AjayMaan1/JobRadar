import { describe, expect, it } from 'vitest'
import { FakeLlmProvider } from '@jobradar/llm'
import { llmExtract } from './llm-extractor.js'

describe('llmExtract via LlmProvider', () => {
  it('maps structured output into ExtractedJob and wraps the description as untrusted data', async () => {
    const llm = new FakeLlmProvider().on('extract_job', (req) => {
      expect(req.user).toContain('<untrusted source="job_description">')
      return { title: 'Backend Engineer', company: 'Acme', description: 'Go services.', salary: '$100k-$120k/yr', location: 'Remote - India', remoteType: 'remote', eligibility: 'india_allowed', eligibilityEvidence: 'Remote - India', seniority: 'senior', category: 'Backend', skills: ['Go'] }
    })
    const r = await llmExtract({ title: 't', company: 'c', applyUrl: 'https://x', description: 'd', sourceFingerprint: 'f', sourceName: 's' } as any, llm)
    expect(r).toMatchObject({ title: 'Backend Engineer', extractionMethod: 'llm', remoteType: 'remote', tags: ['Go'], seniority: 'senior' })
    expect(r!.salary?.min).toBe(100000)
    expect(r!.eligibility.eligibility).toBe('india_allowed')
  })
  it('returns null when no provider is configured', async () => {
    expect(await llmExtract({ title: 't', company: 'c', applyUrl: 'u', description: '', sourceFingerprint: 'f', sourceName: 's' } as any, null)).toBeNull()
  })
})
