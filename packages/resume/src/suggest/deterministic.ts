import type { JobRequirementsData } from '../jd/types.js'
import type { ParseWarning } from '../parse/parseability.js'
import { experienceText, type ResumeContent } from '../schema/resume.js'
import { canonicalizeSkill, findSkills } from '../skills/aliases.js'
import type { AtsBreakdown } from '../score/ats-v1.js'
import type { Proposal } from './types.js'

/** Suggestions that need no LLM and are grounded by construction. */
export function deterministicProposals(content: ResumeContent, reqs: JobRequirementsData, report: AtsBreakdown, warnings: ParseWarning[]): Proposal[] {
  const out: Proposal[] = []
  const semantic = (report as AtsBreakdown & { semantic?: { evidence?: Array<{ skill: string; text: string; similarity: number }> } }).semantic
  const evidenceFor = (skill: string) => semantic?.evidence?.find((e) => e.skill === skill)

  // 1. Skills evidenced in experience but absent from the skills section (and wanted by the JD).
  const listed = new Set(content.skills.flatMap((g) => g.keywords).map((k) => canonicalizeSkill(k).toLowerCase()))
  const wanted = new Set([...reqs.required, ...reqs.preferred].map((r) => r.skill.toLowerCase()))
  const evidenced = findSkills(experienceText(content), { snippets: false }).map((h) => h.canonical).filter((s) => wanted.has(s.toLowerCase()) && !listed.has(s.toLowerCase()))
  if (evidenced.length) {
    const idx = content.skills.length ? content.skills.length - 1 : null
    out.push({
      kind: 'skills_section',
      targetPath: idx === null ? null : `/skills/${idx}/keywords`,
      before: idx === null ? '' : content.skills[idx].keywords.join(', '),
      after: evidenced.join(', '),
      rationale: `These skills appear in your experience bullets and are named in the posting, but are missing from your skills list — keyword-matching ATS look there first.`,
      jdEvidence: evidenced.map((s) => reqs.required.find((r) => r.skill === s)?.evidence).filter(Boolean)[0] ?? null,
    })
  }

  // 2. Missing required skills → confirm questions (never inserted silently).
  const askedGroups = new Set<string>()
  for (const m of report.missing.filter((x) => x.required)) {
    if (m.group) { if (askedGroups.has(m.group)) continue; askedGroups.add(m.group) }
    const ev = evidenceFor(m.skill)
    out.push({
      kind: 'keyword_confirm',
      skill: m.skill,
      rationale: ev
        ? `${m.skill} is not named in your resume, but this looks equivalent: “${ev.text.replace(/^.*?: /, '').slice(0, 140)}”. Is that ${m.skill}? If yes, we'll say it explicitly — ATS keyword filters only see the exact term.`
        : m.group
          ? `The posting asks for ${m.skill} or an alternative. Do you have hands-on experience with it?`
          : `The posting requires ${m.skill}. Have you used it professionally? If yes, say where and how, and we'll draft a grounded bullet.`,
      jdEvidence: m.jdEvidence ?? null,
    })
  }

  // 3. Formatting advice from parse warnings.
  for (const w of warnings.filter((x) => x.severity !== 'info')) {
    out.push({ kind: 'formatting', rationale: w.message, jdEvidence: null, skill: null })
  }

  // 4. Bullet quality nudges that the LLM pass will act on (kept as rationale-only if no LLM).
  const q = report.components.quality
  if (q.points < q.max - 3 && !content.work.some((w) => w.highlights.length)) {
    out.push({ kind: 'formatting', rationale: 'Your roles have no bullet points. Add 3–5 achievement bullets per role (verb + what + measurable outcome).' })
  }
  return out
}
