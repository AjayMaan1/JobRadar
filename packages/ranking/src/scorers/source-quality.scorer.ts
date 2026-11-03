import type { Job } from '@jobradar/db'

/**
 * Source/company quality → 0–5. Quality now comes from the DB (companies.quality_score or
 * sources.quality_score), resolved by the RankingService and passed in; the old hardcoded map is gone.
 */
export function scoreSourceQuality(_job: Pick<Job, 'sourceName'>, quality: number | null | undefined): number {
  const q = typeof quality === 'number' && !isNaN(quality) ? quality : 50
  return Math.round((Math.min(100, Math.max(0, q)) / 100) * 5)
}
