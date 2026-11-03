export type SuggestionKindValue = 'keyword_confirm' | 'bullet_rewrite' | 'reorder' | 'skills_section' | 'formatting' | 'headline' | 'about' | 'answer' | 'cover_letter'

export interface Proposal {
  kind: SuggestionKindValue
  targetPath?: string | null
  before?: string | null
  after?: string | null
  rationale: string
  jdEvidence?: string | null
  skill?: string | null
  variant?: string | null
  question?: string | null
}
