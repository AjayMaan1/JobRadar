import { experienceText, resumeText, skillsText, yearsOfExperience, type ResumeContent } from '../schema/resume.js'
import { findSkills, mentionsSkill } from '../skills/aliases.js'
import { detectSeniority, normalizeTitle } from '../jd/deterministic.js'
import type { JobRequirementsData, RequirementItem, Seniority } from '../jd/types.js'
import { parseabilityPoints, type ParseWarning } from '../parse/parseability.js'

/**
 * ats-v1 — JobRadar's deterministic match score (HLD §7, decision V3).
 *
 * This is OUR estimate of how a keyword-matching ATS plus a skimming recruiter would rate the resume for
 * this job. It is a pure function: same inputs → same output, pinned by golden tests. Bump SCORER_VERSION
 * for any change in weights or logic so historical reports stay comparable.
 *
 * Components (max 100):
 *   requiredSkills 35 · preferredSkills 10 · title 15 · experience 10 · parseability 15 · quality 10 · keywords 5
 */
export const SCORER_VERSION = 'ats-v1'

export type EvidenceWhere = 'experience' | 'skills' | 'summary' | 'other'

export interface MatchedSkill {
  skill: string
  weight: number
  where: EvidenceWhere
  /** Evidence strength used in the coverage formula. */
  strength: number
  snippet?: string
  group?: string
}

export interface MissingSkill {
  skill: string
  weight: number
  required: boolean
  jdEvidence?: string
  group?: string
}

export interface Component {
  points: number
  max: number
  note: string
}

export interface AtsBreakdown {
  scorerVersion: string
  score: number
  components: {
    requiredSkills: Component
    preferredSkills: Component
    title: Component
    experience: Component
    parseability: Component
    quality: Component
    keywords: Component
  }
  matched: MatchedSkill[]
  missing: MissingSkill[]
  keywordsMatched: string[]
  keywordsMissing: string[]
  details: {
    yearsResume: number | null
    yearsRequired: number | null
    seniorityResume: Seniority | null
    seniorityJd: Seniority | null
    titleJd: string | null
    titlesResume: string[]
    bullets: { total: number; withMetrics: number; actionVerbStart: number; goodLength: number; firstPerson: number; duplicates: number }
    stuffing: string[]
    parseWarnings: string[]
  }
}

const EVIDENCE_STRENGTH: Record<EvidenceWhere, number> = { experience: 1, skills: 0.6, summary: 0.5, other: 0.3 }

const GENERIC_TITLE_TOKENS = new Set(['engineer', 'developer', 'software', 'programmer', 'specialist', 'engineering', 'technical', 'technology'])
const TITLE_SYNONYMS: Record<string, string> = { developer: 'engineer', programmer: 'engineer', 'back-end': 'backend', 'front-end': 'frontend', 'full-stack': 'fullstack', 'full': 'fullstack', 'stack': '', sde: 'engineer', swe: 'engineer', devops: 'devops', sre: 'sre', ml: 'ml', ai: 'ai' }
const SENIORITY_RANK: Record<Seniority, number> = { junior: 0, mid: 1, senior: 2, lead: 3, staff: 4, manager: 3 }

const ACTION_VERBS = /^(built|build|led|lead|designed|design|implemented|implement|reduced|reduce|improved|improve|owned|own|migrated|migrate|shipped|ship|drove|drive|delivered|deliver|architected|architect|automated|automate|scaled|scale|launched|launch|optimi[sz]ed|optimi[sz]e|developed|develop|created|create|managed|manage|mentored|mentor|increased|decreased|cut|grew|introduced|established|maintained|refactored|wrote|integrated|deployed|partnered|collaborated|spearheaded|coordinated|defined|enabled|streamlined|engineered|modernized|modernised|consolidated|accelerated|eliminated|achieved|authored|championed|executed|founded|generated|instrumented|negotiated|orchestrated|pioneered|published|resolved|secured|simplified|standardized|standardised|transformed|unified|tested|debugged|diagnosed|monitored|operated|supported|trained|taught|presented|researched|analy[sz]ed|prototyped|rebuilt|re-architected|redesigned|replaced|reviewed|revamped|saved)\b/i

function tokensOf(title: string): string[] {
  return normalizeTitle(title)
    .split(/[\s/,&+]+/)
    .map((t) => TITLE_SYNONYMS[t] ?? t)
    .filter((t) => t && t.length > 1)
}

function titleScore(reqs: JobRequirementsData, resume: ResumeContent): { points: number; note: string; titlesResume: string[]; seniorityResume: Seniority | null } {
  const titlesResume = [resume.basics.label ?? '', ...resume.work.slice(0, 2).map((w) => w.position)].filter(Boolean)
  const jd = reqs.titleNormalized
  const seniorityResume = detectSeniority(titlesResume.join(' ')) ?? seniorityFromYears(yearsOfExperience(resume))
  let points = 0
  let note = ''
  if (!jd) {
    points = 7
    note = 'Job title could not be normalised; neutral score.'
  } else {
    const jdTokens = [...new Set(tokensOf(jd))]
    const core = jdTokens.filter((t) => !GENERIC_TITLE_TOKENS.has(t))
    let best = 0
    for (const t of titlesResume) {
      const rt = new Set(tokensOf(t))
      const hit = (core.length ? core : jdTokens).filter((x) => rt.has(x)).length
      const denom = core.length ? core.length : jdTokens.length
      best = Math.max(best, denom ? hit / denom : 0)
    }
    if (!core.length && best === 0 && titlesResume.some((t) => /engineer|developer/i.test(t))) best = 0.7
    // a summary/headline that names the role ("Backend engineer with …") earns partial credit
    const summary = (resume.basics.summary ?? '').slice(0, 200)
    if (summary && core.length) {
      const st = new Set(tokensOf(summary))
      const hit = core.filter((x) => st.has(x)).length
      best = Math.max(best, (hit / core.length) * 0.7)
    }
    points = Math.round(best * 10)
    note = best >= 0.99 ? `Your titles match "${jd}".` : best > 0 ? `Partial title match with "${jd}" (${Math.round(best * 100)}%).` : `None of your recent titles resemble "${jd}".`
  }
  // seniority: 5 pts
  if (!reqs.seniority) points += 4
  else if (!seniorityResume) { points += 2; note += ' Seniority not detectable from your titles.' }
  else {
    const diff = SENIORITY_RANK[seniorityResume] - SENIORITY_RANK[reqs.seniority]
    if (diff === 0 || diff === 1) points += 5
    else if (Math.abs(diff) === 1 || diff === 2) points += 3
    else { points += 0; note += ` Seniority mismatch: job is ${reqs.seniority}, your profile reads ${seniorityResume}.` }
  }
  return { points: Math.min(15, points), note: note.trim(), titlesResume, seniorityResume }
}

function seniorityFromYears(years: number): Seniority | null {
  if (!years) return null
  if (years < 2) return 'junior'
  if (years < 5) return 'mid'
  if (years < 9) return 'senior'
  return 'lead'
}

function experienceScore(reqs: JobRequirementsData, years: number | null): Component {
  if (reqs.yearsMin === null) return { points: 7, max: 10, note: 'The posting does not state a minimum number of years.' }
  if (years === null) return { points: 3, max: 10, note: `The posting asks for ${reqs.yearsMin}+ years; add dates to your roles so experience can be computed.` }
  const ratio = years / reqs.yearsMin
  const points = ratio >= 1 ? 10 : ratio >= 0.8 ? 7 : ratio >= 0.6 ? 4 : 1
  return { points, max: 10, note: `${years} years of experience vs ${reqs.yearsMin}+ required.` }
}

function locate(skill: string, texts: { experience: string; skills: string; summary: string; all: string }): { where: EvidenceWhere; snippet?: string } | null {
  if (mentionsSkill(texts.experience, skill)) return { where: 'experience', snippet: snippetFor(texts.experience, skill) }
  if (mentionsSkill(texts.skills, skill)) return { where: 'skills' }
  if (mentionsSkill(texts.summary, skill)) return { where: 'summary' }
  if (mentionsSkill(texts.all, skill)) return { where: 'other' }
  return null
}

function snippetFor(text: string, skill: string): string | undefined {
  const line = text.split('\n').find((l) => mentionsSkill(l, skill))
  return line ? line.slice(0, 160) : undefined
}

function coverage(items: RequirementItem[], texts: { experience: string; skills: string; summary: string; all: string }, required: boolean): { ratio: number; matched: MatchedSkill[]; missing: MissingSkill[] } {
  const matched: MatchedSkill[] = []
  const missing: MissingSkill[] = []
  // group alternatives: one entry per group (best evidence), weight = max
  const groups = new Map<string, RequirementItem[]>()
  const singles: RequirementItem[] = []
  for (const it of items) {
    if (it.group) { const g = groups.get(it.group) ?? []; g.push(it); groups.set(it.group, g) } else singles.push(it)
  }
  let num = 0, den = 0
  const consider = (members: RequirementItem[]) => {
    const weight = Math.max(...members.map((m) => m.weight))
    den += weight
    let best: { m: RequirementItem; loc: { where: EvidenceWhere; snippet?: string } } | null = null
    for (const m of members) {
      const loc = locate(m.skill, texts)
      if (loc && (!best || EVIDENCE_STRENGTH[loc.where] > EVIDENCE_STRENGTH[best.loc.where])) best = { m, loc }
    }
    if (best) {
      const strength = EVIDENCE_STRENGTH[best.loc.where]
      num += weight * strength
      matched.push({ skill: best.m.skill, weight, where: best.loc.where, strength, snippet: best.loc.snippet, group: best.m.group })
    } else {
      for (const m of members) missing.push({ skill: m.skill, weight: m.weight, required, jdEvidence: m.evidence, group: m.group })
    }
  }
  for (const s of singles) consider([s])
  for (const g of groups.values()) consider(g)
  return { ratio: den ? num / den : 1, matched, missing }
}

function qualityScore(resume: ResumeContent, allText: string): { component: Component; bullets: AtsBreakdown['details']['bullets']; stuffing: string[] } {
  const bullets = [...resume.work.flatMap((w) => w.highlights), ...resume.projects.flatMap((p) => p.highlights)].map((b) => b.trim()).filter(Boolean)
  const total = bullets.length
  const withMetrics = bullets.filter((b) => /\d/.test(b)).length
  const actionVerbStart = bullets.filter((b) => ACTION_VERBS.test(b.replace(/^[-•*]\s*/, ''))).length
  const goodLength = bullets.filter((b) => b.length >= 40 && b.length <= 220).length
  const firstPerson = bullets.filter((b) => /\b(I|my|me)\b/.test(b)).length
  const seen = new Set<string>()
  let duplicates = 0
  for (const b of bullets) { const k = b.toLowerCase().replace(/\W+/g, ' ').trim(); if (seen.has(k)) duplicates++; else seen.add(k) }

  const stuffing: string[] = []
  for (const hit of findSkills(allText, { snippets: false })) if (hit.count > 6) stuffing.push(`${hit.canonical} ×${hit.count}`)
  const skillCount = resume.skills.reduce((a, g) => a + g.keywords.length, 0)
  if (skillCount > 40) stuffing.push(`${skillCount} items in the skills section`)

  let points: number
  const notes: string[] = []
  if (!total) { points = 2; notes.push('No bullet points under your roles — add 3–5 achievement bullets per role.') }
  else {
    const share = (n: number) => n / total
    const m = share(withMetrics), v = share(actionVerbStart), l = share(goodLength)
    points = (m >= 0.5 ? 4 : m >= 0.3 ? 3 : m >= 0.15 ? 2 : m > 0 ? 1 : 0) + (v >= 0.7 ? 3 : v >= 0.4 ? 2 : v > 0 ? 1 : 0) + (l >= 0.7 ? 2 : l >= 0.4 ? 1 : 0) + 1
    if (m < 0.3) notes.push(`Only ${withMetrics}/${total} bullets contain a number — quantify outcomes.`)
    if (v < 0.7) notes.push(`${total - actionVerbStart} bullets don't start with an action verb.`)
    if (firstPerson) { points -= 1; notes.push('Avoid first person ("I", "my").') }
    if (duplicates) { points -= 1; notes.push(`${duplicates} duplicate bullet(s).`) }
  }
  if (stuffing.length) { points -= 2; notes.push(`Keyword stuffing detected: ${stuffing.join(', ')}.`) }
  points = Math.max(0, Math.min(10, points))
  return { component: { points, max: 10, note: notes.join(' ') || 'Bullets are quantified, verb-led and well sized.' }, bullets: { total, withMetrics, actionVerbStart, goodLength, firstPerson, duplicates }, stuffing }
}

function keywordScore(reqs: JobRequirementsData, allText: string): { component: Component; matched: string[]; missing: string[] } {
  if (!reqs.keywords.length) return { component: { points: 3, max: 5, note: 'No domain keywords extracted for this posting (neutral).' }, matched: [], missing: [] }
  const lower = allText.toLowerCase()
  let num = 0, den = 0
  const matched: string[] = [], missing: string[] = []
  for (const k of reqs.keywords) {
    den += k.weight
    const re = new RegExp(`(?<![a-z0-9])${k.term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i')
    if (re.test(lower)) { num += k.weight; matched.push(k.term) } else missing.push(k.term)
  }
  const ratio = den ? num / den : 1
  return { component: { points: Math.round(ratio * 5), max: 5, note: `${matched.length}/${reqs.keywords.length} domain keywords present.` }, matched, missing }
}

export function scoreResume(resume: ResumeContent, reqs: JobRequirementsData, parseWarnings: ParseWarning[] = []): AtsBreakdown {
  const texts = {
    experience: experienceText(resume),
    skills: skillsText(resume),
    summary: [resume.basics.label ?? '', resume.basics.summary ?? ''].join('\n'),
    all: resumeText(resume),
  }
  const req = coverage(reqs.required, texts, true)
  const pref = coverage(reqs.preferred, texts, false)
  const years = resume.work.length ? yearsOfExperience(resume) : null
  const t = titleScore(reqs, resume)
  const exp = experienceScore(reqs, years)
  const parse = parseabilityPoints(parseWarnings)
  const q = qualityScore(resume, texts.all)
  const kw = keywordScore(reqs, texts.all)

  const requiredSkills: Component = {
    points: Math.round(req.ratio * 35),
    max: 35,
    note: reqs.required.length
      ? `${req.matched.length}/${req.matched.length + new Set(req.missing.map((m) => m.group ?? m.skill)).size} required skills evidenced (${req.matched.filter((m) => m.where === 'experience').length} in experience bullets).`
      : 'The posting lists no identifiable required skills (neutral).',
  }
  if (!reqs.required.length) requiredSkills.points = 25
  const preferredSkills: Component = {
    points: Math.round(pref.ratio * 10),
    max: 10,
    note: reqs.preferred.length ? `${pref.matched.length}/${reqs.preferred.length} nice-to-have skills present.` : 'No nice-to-have skills listed (neutral).',
  }
  if (!reqs.preferred.length) preferredSkills.points = 6

  const components: AtsBreakdown['components'] = {
    requiredSkills,
    preferredSkills,
    title: { points: t.points, max: 15, note: t.note },
    experience: exp,
    parseability: { points: parse, max: 15, note: parseWarnings.length ? parseWarnings.map((w) => w.message).join(' ') : 'The document parses cleanly.' },
    quality: q.component,
    keywords: kw.component,
  }
  const score = Math.max(0, Math.min(100, Object.values(components).reduce((a, c) => a + c.points, 0)))

  return {
    scorerVersion: SCORER_VERSION,
    score,
    components,
    matched: [...req.matched, ...pref.matched],
    missing: [...req.missing, ...pref.missing].sort((a, b) => Number(b.required) - Number(a.required) || b.weight - a.weight),
    keywordsMatched: kw.matched,
    keywordsMissing: kw.missing,
    details: {
      yearsResume: years,
      yearsRequired: reqs.yearsMin,
      seniorityResume: t.seniorityResume,
      seniorityJd: reqs.seniority,
      titleJd: reqs.titleNormalized,
      titlesResume: t.titlesResume,
      bullets: q.bullets,
      stuffing: q.stuffing,
      parseWarnings: parseWarnings.map((w) => w.code),
    },
  }
}

/**
 * Cheap, LLM-free match for the Browse feed (C6-5): profile skills vs skills found in the job text.
 * 0..100; deterministic; no requirements extraction needed.
 */
export function quickMatch(profileSkills: string[], jobTitle: string, jobDescription: string | null, jobSkills: string[] = []): number | null {
  return quickMatchDetail(profileSkills, jobTitle, jobDescription, jobSkills)?.score ?? null
}

export interface QuickMatchDetail {
  score: number
  /** Most-mentioned matched skills, for the one-line "why". */
  matched: string[]
  missing: string[]
}

export function quickMatchDetail(profileSkills: string[], jobTitle: string, jobDescription: string | null, jobSkills: string[] = []): QuickMatchDetail | null {
  if (!profileSkills.length) return null
  const text = `${jobTitle}\n${jobDescription ?? ''}\n${jobSkills.join('\n')}`
  const jd = findSkills(text, { snippets: false }).sort((a, b) => b.count - a.count)
  if (!jd.length) return null
  const have = new Set(profileSkills.map((s) => s.toLowerCase()))
  let num = 0, den = 0
  const matched: string[] = [], missing: string[] = []
  for (const h of jd) {
    const w = Math.min(3, h.count)
    den += w
    if (have.has(h.canonical.toLowerCase())) { num += w; matched.push(h.canonical) } else missing.push(h.canonical)
  }
  return { score: Math.round((num / den) * 100), matched: matched.slice(0, 4), missing: missing.slice(0, 3) }
}
