import type { Job } from '@jobradar/db'

export function scoreSalaryTransparency(job: Job): number {
  if (job.salaryMin !== null && job.salaryMax !== null) return 5
  if (job.salaryMin !== null || job.salaryMax !== null) return 3
  return 0
}
