import type { Job } from '@jobradar/db'
import { RANKING_CONFIG } from '../config.js'

export interface RoleFitPrefs {
  targetSkills: string[]
  preferredCategories: string[]
  preferredSeniority: string[]
  /** Titles the candidate is targeting (from the profile); a match adds to the category points. */
  targetTitles?: string[]
}

/**
 * Role fit (max 15). Preferences come from the candidate profile when one exists (C5-7), otherwise from the
 * static RANKING_CONFIG. Skills are compared case-insensitively on canonical names.
 */
export function scoreRoleFit(job: Job, prefs: RoleFitPrefs = RANKING_CONFIG): number {
  let pts = 0

  // Skill match: up to 8 pts
  let parsedSkills: string[] = []
  try {
    parsedSkills = typeof job.skills === 'string' ? JSON.parse(job.skills) : (job.skills ?? [])
  } catch {
    parsedSkills = []
  }

  const jobSkills = parsedSkills.map((s) => s.toLowerCase())
  const targetSkills = new Set(prefs.targetSkills.map((s) => s.toLowerCase()))
  const matchCount = jobSkills.filter((s) => targetSkills.has(s)).length
  pts += Math.min(matchCount * 2, 8)

  // Category match (or target-title match from the profile): 4 pts
  const titleHit = (prefs.targetTitles ?? []).some((t) => t && job.title.toLowerCase().includes(t.toLowerCase().replace(/\b(senior|junior|lead|staff|sr\.?|jr\.?)\b/g, '').trim()))
  if ((job.category && prefs.preferredCategories.includes(job.category)) || titleHit) {
    pts += 4
  }

  // Seniority match: 3 pts
  if (job.seniority && prefs.preferredSeniority.includes(job.seniority)) {
    pts += 3
  }

  return Math.min(pts, 15)
}
