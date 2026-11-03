/** Title/context relevance filter, shared by adapters, engines and the enrich pipeline. */

export const TITLE_INCLUDE_PATTERNS = [
  /\bsoftware engineer\b/i, /\bsoftware developer\b/i, /\bfull[- ]?stack\b/i, /\bfront[- ]?end\b/i,
  /\bback[- ]?end\b/i, /\bdeveloper\b/i, /\bengineer(ing)?\b/i, /\bprogrammer\b/i, /\barchitect\b/i, /\bdevops\b/i, /\bsre\b/i, /\bsite reliability\b/i,
  /\bplatform engineer\b/i, /\binfrastructure engineer\b/i, /\bcloud engineer\b/i, /\bsecurity engineer\b/i,
  /\bdata engineer\b/i, /\banalytics engineer\b/i, /\bdata scientist\b/i, /\bmachine learning\b/i,
  /\bml engineer\b/i, /\bai engineer\b/i, /\bapplied ai\b/i, /\bllm\b/i, /\bnlp\b/i, /\bprompt engineer\b/i,
  /\bresearch engineer\b/i, /\bapplied scientist\b/i, /\bproduct engineer\b/i, /\bfounding engineer\b/i,
  /\bforward deployed\b/i, /\bmobile engineer\b/i, /\bios engineer\b/i, /\bandroid engineer\b/i,
  /\bqa automation\b/i, /\btest automation\b/i, /\bsolutions architect\b/i, /\bsoftware architect\b/i,
  /\bdistributed systems\b/i, /\bengineering manager\b/i, /\bstaff engineer\b/i, /\bprincipal engineer\b/i,
]

export const TITLE_EXCLUDE_PATTERNS = [
  /\bmarketing\b/i, /\bsales\b/i, /\baccount executive\b/i, /\bcustomer success\b/i, /\brecruit/i,
  /\btalent acquisition\b/i, /\bhr\b/i, /\bpeople ops\b/i, /\bfinance\b/i, /\blegal\b/i, /\bseo\b/i,
  /\bgrowth\b/i, /\bsocial media\b/i, /\bcontent\b/i, /\bcopywriter\b/i, /\bdesigner\b/i,
  /\bproduct manager\b/i, /\bproject manager\b/i, /\bscrum master\b/i,
  // non-software engineering disciplines
  /\b(mechanical|civil|electrical|structural|chemical|hardware|manufacturing|process|field|hvac|rf|optical|biomedical|aerospace|automotive|facilities|quality assurance \(manufacturing\)|network field|sales|pre-?sales|customer|support|solutions? consultant|implementation) engineer\b/i,
  /\bengineering (manager|director|recruiter|coordinator)\b/i,
]

export const CONTEXT_INCLUDE_PATTERNS = [
  /\bpython\b/i, /\btypescript\b/i, /\bjavascript\b/i, /\bjava\b/i, /\bgo\b/i, /\brust\b/i, /\breact\b/i,
  /\bnode\b/i, /\baws\b/i, /\bgcp\b/i, /\bazure\b/i, /\bkubernetes\b/i, /\bdocker\b/i, /\bsql\b/i,
  /\bpostgres/i, /\bmysql\b/i, /\bgraphql\b/i, /\btensorflow\b/i, /\bpytorch\b/i, /\blangchain\b/i,
  /\brag\b/i, /\bmachine learning\b/i, /\bartificial intelligence\b/i, /\bmicroservices\b/i, /\bterraform\b/i,
  /\bspark\b/i, /\bhadoop\b/i,
]

export function isRelevantRole(title: string, tags: string[] = [], description = ''): boolean {
  const titleText = (title ?? '').trim()
  if (!titleText) return false
  const normalizedTitle = titleText.toLowerCase()
  const context = `${titleText} ${tags.join(' ')} ${description}`.toLowerCase()
  const hasPositiveTitle = TITLE_INCLUDE_PATTERNS.some((p) => p.test(titleText))
  const hasPositiveContext = CONTEXT_INCLUDE_PATTERNS.some((p) => p.test(context))
  const hasNegativeTitle = TITLE_EXCLUDE_PATTERNS.some((p) => p.test(normalizedTitle))
  const hasTechnicalRoleHint = /\b(engineer|developer|architect|programmer|scientist)\b/i.test(titleText)
  if (hasNegativeTitle) return false
  if (hasPositiveTitle) return true
  return hasTechnicalRoleHint && hasPositiveContext
}

/** Cheap engineering-department check used for company-level engineering_share. */
export function isEngineeringDepartment(department: string | null | undefined): boolean {
  if (!department) return false
  return /\b(engineering|software|platform|infrastructure|data|machine learning|ai|research|security|devops|product engineering|technology|r&d)\b/i.test(department)
}
