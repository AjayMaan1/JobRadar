/**
 * Browser-safe entry for the visual editor (docs/HLD-resume-editor.md §2): schema, scorer, grounding,
 * suggestion application, HTML template and diff helpers. Pure TypeScript + zod only — no Prisma, no
 * pdf/docx/node modules — so the web bundle stays small and "what you see is what gets stored".
 */
export { ResumeContentSchema, emptyResume, resumeText, yearsOfExperience } from './schema/resume.js'
export type { ResumeContent, Work, SkillGroup } from './schema/resume.js'
export { scoreResume, quickMatchDetail, SCORER_VERSION } from './score/ats-v1.js'
export type { AtsBreakdown, MatchedSkill, MissingSkill } from './score/ats-v1.js'
export { validateGrounding } from './ground/validate.js'
export type { GroundingResult } from './ground/validate.js'
export { applyProposal } from './suggest/apply.js'
export type { Proposal, SuggestionKindValue } from './suggest/types.js'
export { renderAtsClassicHtml, TEMPLATE_VERSION } from './render/template-ats-classic.js'
export { diffContent, groundChanges, bulletsToText, textToBullets, keywordsToText, textToKeywords, getAt, setAt } from './version/editor.js'
export type { ContentChange, ChangeGrounding } from './version/editor.js'
export type { JobRequirementsData } from './jd/types.js'
export type { ParseWarning } from './parse/parseability.js'
