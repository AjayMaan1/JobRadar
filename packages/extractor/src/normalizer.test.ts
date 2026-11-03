import { describe, expect, it } from 'vitest'
import { normalizeJob } from './normalizer.js'
import type { ExtractedJob } from './deterministic.js'

const source = {
  name: 'Test Source',
  sourceType: 'job_board',
} as any

function makeExtracted(overrides: Partial<ExtractedJob> = {}): ExtractedJob {
  return {
    title: 'Senior Backend Engineer',
    company: 'Acme',
    applyUrl: 'https://board-a.example/jobs/123',
    sourceUrl: 'https://board-a.example/jobs/123',
    description: 'Remote backend role for global candidates.',
    postedAt: '2026-05-22T00:00:00.000Z',
    salary: null,
    location: 'Worldwide',
    eligibility: {
      eligibility: 'worldwide',
      confidence: 0.9,
      evidence: ['worldwide'],
    },
    tags: ['Node.js', 'PostgreSQL'],
    seniority: 'senior',
    category: 'Backend',
    remoteType: 'remote',
    sourceFingerprint: 'test-1',
    extractionMethod: 'deterministic',
    confidence: 0.9,
    ...overrides,
  }
}

describe('normalizeJob canonical hash', () => {
  it('matches the same role across different source URLs', () => {
    const boardA = normalizeJob(makeExtracted(), source)
    const boardB = normalizeJob(
      makeExtracted({
        applyUrl: 'https://board-b.example/listings/acme-senior-backend-engineer',
        sourceUrl: 'https://board-b.example/listings/acme-senior-backend-engineer',
        sourceFingerprint: 'test-2',
      }),
      source
    )

    expect(boardA.canonicalHash).toBe(boardB.canonicalHash)
  })

  it('distinguishes materially different locations', () => {
    const globalRole = normalizeJob(makeExtracted(), source)
    const indiaOnlyRole = normalizeJob(
      makeExtracted({
        location: 'India',
        eligibility: {
          eligibility: 'india_allowed',
          confidence: 0.95,
          evidence: ['india'],
        },
      }),
      source
    )

    expect(globalRole.canonicalHash).not.toBe(indiaOnlyRole.canonicalHash)
  })

  it('ignores remoteType (text-derived, differs per source) so the same role hashes equal across sources', () => {
    const a = normalizeJob(makeExtracted({ remoteType: 'remote' }), source)
    const b = normalizeJob(makeExtracted({ remoteType: 'unknown', description: '' }), source)
    expect(a.canonicalHash).toBe(b.canonicalHash)
  })

  it('normalises the apply URL (tracking params, fragment, trailing slash, case)', () => {
    const a = normalizeJob(makeExtracted({ applyUrl: 'https://Boards.Greenhouse.io/acme/jobs/123?gh_src=abc&utm_source=x#top' }), source)
    const b = normalizeJob(makeExtracted({ applyUrl: 'https://boards.greenhouse.io/acme/jobs/123/' }), source)
    expect(a.applyUrlNormalized).toBe('https://boards.greenhouse.io/acme/jobs/123')
    expect(a.applyUrlNormalized).toBe(b.applyUrlNormalized)
  })

  it('derives city from the location line and does not confuse Ukraine with UK', () => {
    expect(normalizeJob(makeExtracted({ location: 'Noida, Uttar Pradesh, India' }), source)).toMatchObject({ city: 'Noida', country: 'IN', region: 'India' })
    expect(normalizeJob(makeExtracted({ location: 'Remote - Ukraine' }), source).country).not.toBe('GB')
    expect(normalizeJob(makeExtracted({ location: 'London, UK' }), source).country).toBe('GB')
  })
})

import { DedupeService } from './dedupe.js'
import { createFakePrisma } from '../../../tools/testkit/fake-prisma.js'

describe('DedupeService.upsert', () => {
  it('returns created=true once, then matches by normalised URL and never erases richer fields on re-sighting', async () => {
    const prisma = createFakePrisma()
    const svc = new DedupeService(prisma as any)
    const rich = normalizeJob(makeExtracted({ salary: { min: 150000, max: 190000, currency: 'USD', period: 'year' }, description: 'Long description about the role. Python.' }), source)
    const a = await svc.upsert(rich, { opportunityClass: 'p1_global_remote', classReason: 'india-ok' })
    expect(a.created).toBe(true)
    expect(a.job.salaryMin).toBe(150000)
    // sparse re-sighting: same URL with tracking param, no salary, no description
    const sparse = normalizeJob(makeExtracted({ applyUrl: 'https://board-a.example/jobs/123?utm_source=x', salary: null, description: '' }), source)
    const b = await svc.upsert(sparse, { opportunityClass: 'none', classReason: 'not remote: unknown location' })
    expect(b.created).toBe(false)
    expect(b.matchedBy).toBe('url')
    expect(b.job.id).toBe(a.job.id)
    expect(b.job.salaryMin).toBe(150000)
    expect(b.job.description).toMatch(/Long description/)
    expect(b.job.opportunityClass).toBe('p1_global_remote')
  })

  it('a closed job that reappears comes back as new', async () => {
    const prisma = createFakePrisma()
    const svc = new DedupeService(prisma as any)
    const n = normalizeJob(makeExtracted(), source)
    const a = await svc.upsert(n)
    await prisma.job.update({ where: { id: a.job.id }, data: { status: 'closed', closedAt: new Date() } })
    const b = await svc.upsert(n)
    expect(b.job.status).toBe('new')
    expect(b.job.closedAt).toBeNull()
  })
})
