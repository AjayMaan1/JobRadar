export interface RawJob {
  title: string
  company: string
  applyUrl: string
  sourceUrl?: string
  description: string
  postedAt?: string
  salary?: string
  location?: string
  tags?: string[]
  sourceFingerprint: string
  sourceName: string
}

export interface AdapterResult {
  jobs: RawJob[]
  sourceId: string
  fetchedAt: Date
  cacheHit: boolean
}

export interface SourceConfig {
  id: string
  name: string
  domain: string
  ingestionMethod: string
  apiUrl?: string | null
  careersUrl?: string | null
  companyId?: string | null
  atsType?: string | null
  region?: string | null
  country?: string | null
  rateDelayMs: number
  refreshIntervalHours: number
  qualityScore: number
}

export interface SourceSeedRecord {
  name: string
  domain: string
  sourceType: 'job_board' | 'recruiter_agency' | 'ats_page' | 'company_career_page' | 'aggregator'
  region?: string
  country?: string
  ingestionMethod: 'api' | 'rss' | 'scrape_cheerio' | 'scrape_playwright' | 'ats_greenhouse' | 'ats_lever' | 'ats_ashby' | 'ats_workable' | 'ats_workday' | 'ats_smartrecruiters' | 'platform_uplers'
  apiUrl?: string
  careersUrl?: string
  companyId?: string
  atsType?: string
  qualityScore: number
  refreshIntervalHours: number
  enabled?: boolean
  notes?: string
}
