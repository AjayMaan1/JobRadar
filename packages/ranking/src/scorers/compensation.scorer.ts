import type { Job } from '@jobradar/db'
import { RANKING_CONFIG } from '../config.js'

export function scoreCompensation(job: Job): number {
  const inrMin = job.salaryInrMin
  if (!inrMin || inrMin <= 0) return 0

  const lakhs = inrMin / 100_000

  for (const band of RANKING_CONFIG.salaryBands) {
    if (lakhs >= band.minInrLakhs) return band.pts
  }

  return 0
}
