import type { Job } from '@jobradar/db'

/**
 * Freshness is computed at READ time from first_seen_at (earliest sighting) so a job's rank decays
 * without re-crawling. Max 10.
 */
export function scoreFreshness(job: Pick<Job, 'firstSeenAt' | 'postedAt' | 'discoveredAt'>, now = Date.now()): number {
  const date = job.firstSeenAt ?? job.postedAt ?? job.discoveredAt
  if (!date) return 0
  const ageHours = (now - new Date(date).getTime()) / 3_600_000
  if (ageHours <= 1) return 10
  if (ageHours <= 6) return 9
  if (ageHours <= 24) return 7
  if (ageHours <= 72) return 4
  if (ageHours <= 168) return 2
  return 0
}
