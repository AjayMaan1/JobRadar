import type { Job } from '@jobradar/db'

/** Priority class band (locked): P1 40 · P2 30 · P3 15 · none 0. */
export const CLASS_BAND: Record<string, number> = {
  p1_global_remote: 40,
  p2_india_remote: 30,
  p3_ncr_hybrid: 15,
  none: 0,
}

export function scoreClass(job: Pick<Job, 'opportunityClass' | 'employmentType'>): number {
  const base = CLASS_BAND[String(job.opportunityClass)] ?? 0
  // Contract and full-time are both accepted with no penalty; internships/part-time are excluded upstream.
  return base
}
