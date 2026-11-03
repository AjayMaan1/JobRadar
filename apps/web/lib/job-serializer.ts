import type { Job as DbJob } from '@jobradar/db'
import type { Job } from './api-client'

function parseSkills(rawSkills: string): string[] {
  try {
    const parsed = JSON.parse(rawSkills)
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return rawSkills.split(',').map((skill) => skill.trim()).filter(Boolean)
  }
}

/** Freshness applied at read time (mirrors @jobradar/ranking scoreFreshness; kept local so the web app stays light). */
function freshness(firstSeenAt: Date, now = Date.now()): number {
  const ageHours = (now - firstSeenAt.getTime()) / 3_600_000
  if (ageHours <= 1) return 10
  if (ageHours <= 6) return 9
  if (ageHours <= 24) return 7
  if (ageHours <= 72) return 4
  if (ageHours <= 168) return 2
  return 0
}

export type UserState = 'saved' | 'applied' | 'rejected' | null

/**
 * `status` in the API stays backwards compatible: it is the per-user state when one exists, else the lifecycle
 * status (new | closed). `userState` is the explicit per-user value (v3, C2).
 */
export function serializeJob(job: DbJob, userState: UserState = null, extra: Partial<Job> = {}): Job {
  const firstSeenAt = job.firstSeenAt ?? job.discoveredAt
  const displayScore = Math.min(100, Math.max(0, Math.round((job.baseScore ?? 0) + freshness(firstSeenAt))))
  // Audit NEW-03: the crawled description is never overwritten; a user-pasted copy is shown only when the
  // crawled one is unusable, with provenance so the UI can label it.
  const j = job as DbJob & { descriptionManual?: string | null; descriptionManualBy?: string | null; descriptionManualAt?: Date | null; searchTsv?: unknown }
  const crawled = (j.description ?? '').trim()
  const manual = (j.descriptionManual ?? '').trim()
  const useManual = crawled.length < 200 && manual.length >= 200
  const { searchTsv: _tsv, descriptionManual: _dm, descriptionManualBy: _by, descriptionManualAt: _at, ...rest } = j
  void _tsv; void _dm; void _by; void _at
  return {
    ...(rest as DbJob),
    ...extra,
    description: useManual ? manual : j.description ?? null,
    descriptionSource: useManual ? 'manual' : crawled ? 'crawl' : null,
    descriptionManualAt: j.descriptionManualAt ? j.descriptionManualAt.toISOString() : null,
    userState,
    status: userState ?? job.status,
    skills: parseSkills(job.skills),
    postedAt: job.postedAt?.toISOString() ?? null,
    discoveredAt: job.discoveredAt.toISOString(),
    firstSeenAt: firstSeenAt.toISOString(),
    lastSeenAt: (job.lastSeenAt ?? job.discoveredAt).toISOString(),
    closedAt: job.closedAt?.toISOString() ?? null,
    updatedAt: job.updatedAt?.toISOString() ?? null,
    livenessCheckedAt: job.livenessCheckedAt?.toISOString() ?? null,
    opportunityClass: String(job.opportunityClass ?? 'none') as Job['opportunityClass'],
    employmentType: String(job.employmentType ?? 'unknown') as Job['employmentType'],
    rankingScore: displayScore,
  }
}
