import { describe, expect, it } from 'vitest'
import { serializeJob } from './job-serializer'

describe('serializeJob', () => {
  it('parses JSON skills and serializes dates', () => {
    const discoveredAt = new Date('2026-05-20T11:00:00.000Z')
    const postedAt = new Date('2026-05-19T08:30:00.000Z')

    const job = serializeJob({
      id: 'job-1',
      title: 'Senior Engineer',
      company: 'Acme',
      sourceName: 'Jobicy',
      sourceType: 'job_board',
      sourceUrl: 'https://example.com/job',
      applyUrl: 'https://example.com/apply',
      country: 'IN',
      region: 'India',
      city: 'Bengaluru',
      remoteType: 'remote',
      eligibility: 'india_allowed',
      eligibilityConfidence: 0.9,
      eligibilityEvidence: 'India mentioned explicitly',
      salaryMin: 100000,
      salaryMax: 150000,
      salaryCurrency: 'USD',
      salaryPeriod: 'year',
      salaryConfidence: 0.8,
      salaryInrMin: 8300000,
      salaryInrMax: 12450000,
      experienceMin: 5,
      experienceMax: 8,
      seniority: 'senior',
      category: 'Backend',
      skills: '["TypeScript","Node.js"]',
      description: 'Build systems',
      postedAt,
      discoveredAt,
      expiresAt: null,
      sourceFingerprint: 'fingerprint-1',
      canonicalHash: 'hash-1',
      rankingScore: 91,
      baseScore: 81,
      status: 'new',
      notes: null,
      companyId: null,
      employmentType: 'full_time',
      opportunityClass: 'p1_global_remote',
      classReason: 'india-ok: worldwide',
      firstSeenAt: new Date(Date.now() - 30 * 60_000),
      lastSeenAt: new Date(),
      closedAt: null,
      livenessCheckedAt: null,
      updatedAt: new Date(),
    } as any)

    expect(job.skills).toEqual(['TypeScript', 'Node.js'])
    expect(job.postedAt).toBe(postedAt.toISOString())
    expect(job.discoveredAt).toBe(discoveredAt.toISOString())
    expect(job.opportunityClass).toBe('p1_global_remote')
    // display score = base + freshness at read time (first seen 30 min ago → +10)
    expect(job.rankingScore).toBe(91)
  })

  it('falls back to comma-separated skills', () => {
    const job = serializeJob({
      id: 'job-2',
      title: 'Frontend Engineer',
      company: 'Acme',
      sourceName: 'Manual',
      sourceType: null,
      sourceUrl: null,
      applyUrl: null,
      country: null,
      region: null,
      city: null,
      remoteType: 'hybrid',
      eligibility: 'unknown',
      eligibilityConfidence: null,
      eligibilityEvidence: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      salaryConfidence: null,
      salaryInrMin: null,
      salaryInrMax: null,
      experienceMin: null,
      experienceMax: null,
      seniority: null,
      category: null,
      skills: 'React, TypeScript, CSS',
      description: null,
      postedAt: null,
      discoveredAt: new Date('2026-05-20T12:00:00.000Z'),
      expiresAt: null,
      sourceFingerprint: null,
      canonicalHash: 'hash-2',
      rankingScore: 55,
      baseScore: 55,
      status: 'saved',
      notes: null,
      companyId: null,
      employmentType: 'unknown',
      opportunityClass: 'none',
      classReason: null,
      firstSeenAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSeenAt: new Date('2026-01-01T00:00:00.000Z'),
      closedAt: new Date('2026-02-01T00:00:00.000Z'),
      livenessCheckedAt: null,
      updatedAt: new Date(),
    } as any)

    expect(job.skills).toEqual(['React', 'TypeScript', 'CSS'])
    expect(job.postedAt).toBeNull()
    expect(job.closedAt).toBe('2026-02-01T00:00:00.000Z')
    expect(job.rankingScore).toBe(55) // old job: zero freshness
  })
})
