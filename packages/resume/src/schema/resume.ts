import { z } from 'zod'

/**
 * Canonical resume content = a JSON Resume (https://jsonresume.org/schema) subset plus a few extensions.
 * Every ResumeVersion.content validates against `ResumeContentSchema`. Keep this the ONLY shape the rest
 * of the system reasons about; rendering, scoring and suggestions are pure functions over it.
 */

const DateStr = z.string().regex(/^\d{4}(-\d{2})?(-\d{2})?$/, 'YYYY, YYYY-MM or YYYY-MM-DD').or(z.literal('')).optional()

export const ProfileLinkSchema = z.object({
  network: z.string().default(''),      // LinkedIn, GitHub, …
  username: z.string().optional(),
  url: z.string().optional(),
})

export const BasicsSchema = z.object({
  name: z.string().default(''),
  /** Headline, e.g. "Senior Backend Engineer · Go / Kubernetes". Master value lives on the profile too. */
  label: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  url: z.string().optional(),
  /** "About me" / professional summary. */
  summary: z.string().optional(),
  location: z
    .object({
      city: z.string().optional(),
      region: z.string().optional(),
      countryCode: z.string().optional(),
    })
    .optional(),
  profiles: z.array(ProfileLinkSchema).default([]),
})

export const WorkSchema = z.object({
  name: z.string().default(''),          // employer
  position: z.string().default(''),
  location: z.string().optional(),
  url: z.string().optional(),
  startDate: DateStr,
  endDate: DateStr,                      // '' or undefined = present
  summary: z.string().optional(),
  highlights: z.array(z.string()).default([]),
  /** Extension: technologies named for this role (kept separate from prose). */
  keywords: z.array(z.string()).default([]),
})

export const EducationSchema = z.object({
  institution: z.string().default(''),
  area: z.string().optional(),           // Computer Science
  studyType: z.string().optional(),      // B.Tech, M.Sc
  startDate: DateStr,
  endDate: DateStr,
  score: z.string().optional(),
  courses: z.array(z.string()).default([]),
})

export const SkillGroupSchema = z.object({
  name: z.string().default(''),          // "Languages", "Cloud"
  level: z.string().optional(),
  keywords: z.array(z.string()).default([]),
})

export const ProjectSchema = z.object({
  name: z.string().default(''),
  description: z.string().optional(),
  highlights: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  url: z.string().optional(),
  startDate: DateStr,
  endDate: DateStr,
})

export const CertificateSchema = z.object({
  name: z.string().default(''),
  issuer: z.string().optional(),
  date: DateStr,
  url: z.string().optional(),
})

export const LanguageSchema = z.object({ language: z.string().default(''), fluency: z.string().optional() })

export const ResumeContentSchema = z.object({
  basics: BasicsSchema.default({}),
  work: z.array(WorkSchema).default([]),
  education: z.array(EducationSchema).default([]),
  skills: z.array(SkillGroupSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  certificates: z.array(CertificateSchema).default([]),
  languages: z.array(LanguageSchema).default([]),
  /** Free-form sections we could not map (Awards, Publications…) — preserved, rendered verbatim. */
  sections: z.array(z.object({ title: z.string(), items: z.array(z.string()).default([]) })).default([]),
  meta: z
    .object({
      /** Order of top-level sections in the source document (drives rendering order). */
      sectionOrder: z.array(z.string()).optional(),
    })
    .optional(),
})

export type ResumeContent = z.infer<typeof ResumeContentSchema>
export type Work = z.infer<typeof WorkSchema>
export type SkillGroup = z.infer<typeof SkillGroupSchema>

/** Same shape but every field optional/nullable — what we ask the LLM for (it may omit what it can't find). */
export const ResumeContentLooseSchema = ResumeContentSchema.deepPartial()

export function emptyResume(): ResumeContent {
  return ResumeContentSchema.parse({})
}

/** All prose of a resume as a flat string (for keyword search); bullets joined by newlines. */
export function resumeText(c: ResumeContent): string {
  const parts: string[] = []
  const b = c.basics
  parts.push(b.name, b.label ?? '', b.summary ?? '')
  for (const w of c.work) parts.push(w.position, w.name, w.summary ?? '', ...w.highlights, ...w.keywords)
  for (const p of c.projects) parts.push(p.name, p.description ?? '', ...p.highlights, ...p.keywords)
  for (const s of c.skills) parts.push(s.name, ...s.keywords)
  for (const e of c.education) parts.push(e.institution, e.area ?? '', e.studyType ?? '', ...e.courses)
  for (const cert of c.certificates) parts.push(cert.name, cert.issuer ?? '')
  for (const s of c.sections) parts.push(s.title, ...s.items)
  return parts.filter(Boolean).join('\n')
}

/** Text of the experience-type content only (work + projects) — where skill evidence carries full weight. */
export function experienceText(c: ResumeContent): string {
  const parts: string[] = []
  for (const w of c.work) parts.push(w.position, w.summary ?? '', ...w.highlights, ...w.keywords)
  for (const p of c.projects) parts.push(p.name, p.description ?? '', ...p.highlights, ...p.keywords)
  return parts.filter(Boolean).join('\n')
}

/** Text of the skills section only. */
export function skillsText(c: ResumeContent): string {
  return c.skills.flatMap((s) => [s.name, ...s.keywords]).filter(Boolean).join('\n')
}

/** Parse a date like 2021-03 → ms; '' / undefined → null (present). */
export function parseResumeDate(d: string | undefined): number | null {
  if (!d) return null
  const m = d.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/)
  if (!m) return null
  return Date.UTC(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) - 1 : 0, m[3] ? parseInt(m[3], 10) : 1)
}

/** Total years of work experience from merged (overlap-free) work intervals. */
export function yearsOfExperience(c: ResumeContent, now = Date.now()): number {
  const ivs = c.work
    .map((w) => ({ s: parseResumeDate(w.startDate), e: parseResumeDate(w.endDate) ?? now }))
    .filter((x): x is { s: number; e: number } => x.s !== null && x.e >= x.s)
    .sort((a, b) => a.s - b.s)
  let total = 0
  let cur: { s: number; e: number } | null = null
  for (const iv of ivs) {
    if (!cur || iv.s > cur.e) { if (cur) total += cur.e - cur.s; cur = { ...iv } }
    else cur.e = Math.max(cur.e, iv.e)
  }
  if (cur) total += cur.e - cur.s
  return Math.round((total / (365.25 * 86400_000)) * 10) / 10
}
