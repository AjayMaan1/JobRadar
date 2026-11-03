import { canonicalizeSkill, findSkills } from '../skills/aliases.js'
import { experienceText, skillsText, yearsOfExperience, type ResumeContent } from '../schema/resume.js'

export interface ProfileSkill {
  name: string
  canonical: string
  /** Where it was found: skills section, experience bullets, or both. */
  source: 'skills' | 'experience' | 'both'
  confirmed: boolean
}

export interface ProfileSeed {
  headline: string | null
  about: string | null
  skills: ProfileSkill[]
  yearsExperience: number | null
  targetTitles: string[]
}

/** Derive the candidate profile from a master resume. Everything here is evidenced by the resume itself. */
export function profileFromResume(c: ResumeContent): ProfileSeed {
  const listed = new Map<string, ProfileSkill>()
  for (const g of c.skills) for (const k of g.keywords) {
    const canonical = canonicalizeSkill(k)
    if (!listed.has(canonical)) listed.set(canonical, { name: k, canonical, source: 'skills', confirmed: true })
  }
  for (const hit of findSkills(experienceText(c), { snippets: false })) {
    const cur = listed.get(hit.canonical)
    if (cur) cur.source = 'both'
    else listed.set(hit.canonical, { name: hit.canonical, canonical: hit.canonical, source: 'experience', confirmed: true })
  }
  // skills section may contain unknown tools — keep them (already added above via canonicalizeSkill passthrough)
  void skillsText

  const titles = c.work.slice(0, 2).map((w) => w.position).filter(Boolean)
  const headline = c.basics.label?.trim() || (titles[0] ? titles[0] : null)
  return {
    headline,
    about: c.basics.summary?.trim() || null,
    skills: [...listed.values()],
    yearsExperience: c.work.length ? yearsOfExperience(c) : null,
    targetTitles: [...new Set(titles)],
  }
}
