export interface RequirementItem {
  /** Canonical skill name (dictionary) or the JD's own term for unknown skills. */
  skill: string
  /** 0..1 importance. Required-section skills ≈ 1.0, responsibilities 0.8, intro 0.6, preferred 0.4. */
  weight: number
  /** Short JD snippet proving the requirement. */
  evidence?: string
  /** Where it came from. */
  source: 'title' | 'required' | 'responsibilities' | 'intro' | 'preferred' | 'llm'
  /** Alternatives ("Go or Java"): items sharing a group are satisfied when any one of them matches. */
  group?: string
}

export interface KeywordItem {
  term: string
  weight: number
}

export type Seniority = 'junior' | 'mid' | 'senior' | 'lead' | 'staff' | 'manager'

export interface JobRequirementsData {
  extractorVersion: string
  titleNormalized: string | null
  seniority: Seniority | null
  yearsMin: number | null
  required: RequirementItem[]
  preferred: RequirementItem[]
  keywords: KeywordItem[]
  llmUsed: boolean
  /** Diagnostics: which sections were recognised. */
  sections: Record<string, number>
}

export const JD_EXTRACTOR_VERSION = 'jd-v1'
