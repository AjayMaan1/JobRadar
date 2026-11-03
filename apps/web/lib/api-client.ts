export type OpportunityClass = 'p1_global_remote' | 'p2_india_remote' | 'p3_ncr_hybrid' | 'none'
export type EmploymentType = 'full_time' | 'contract' | 'part_time' | 'internship' | 'unknown'

export const CLASS_LABEL: Record<OpportunityClass, string> = {
  p1_global_remote: 'P1 · Global remote',
  p2_india_remote: 'P2 · India remote',
  p3_ncr_hybrid: 'P3 · NCR hybrid',
  none: 'Other',
}

export interface JobFilters {
  tab?: 'browse' | 'saved' | 'applied' | 'rejected' | 'closed'
  /** legacy class id, or a tier id from the user's preferences (v5), or 'eligible' = the user's default tiers */
  class?: OpportunityClass | 'eligible' | string
  sort?: 'newest' | 'score' | 'match'
  includeClosed?: 'true'
  since?: string
  employmentType?: EmploymentType
  company?: string
  remoteType?: string
  region?: string
  eligibility?: string
  category?: string
  salaryMin?: string
  experienceMax?: string
  sourceType?: string
  q?: string
  page?: number
  limit?: number
}

export interface JobsResponse {
  data: Job[]
  total: number
  page: number
  limit: number
  /** sort=match ranks within a bounded recent window; true when older jobs were left out. */
  windowed?: boolean
  /** sort=match on stored fits: jobs not yet embedded/scored (appear after the backfill). */
  unscored?: number
  hybrid?: boolean
  /** Synonyms added to the search (fallback when no embedding model is running). */
  expandedTerms?: string[]
  /** v5: which engine built this page; `evalsPending` = preferences exist but nothing evaluated yet. */
  engine?: 'evals' | 'legacy'
  evalsPending?: boolean
  tiers?: Array<{ id: string; label: string; enabled: boolean }>
}

// ── v5: dynamic preferences ──────────────────────────────────────────────────
export interface PreferencesDoc {
  schemaVersion: number
  home: { country: string; metros: string[]; timezone: string; utcOffset?: number; currency: string }
  work: { modes: Array<'remote' | 'hybrid' | 'onsite'>; hybridMetros: 'home.metros' | string[]; onsiteMetros: 'home.metros' | string[] }
  role: { targetTitles: string[]; categories: string[]; seniority: string[]; skills: string[]; employmentTypes: string[] }
  pay: { floor: number | null; currency: string; bands: Array<{ min: number; pts: number }>; requireTransparency: boolean }
  companies: { excludeHqCountries: string[]; exclude: string[]; onlyTags: string[] }
  tiers: Array<{ id: string; label: string; enabled: boolean; instant: boolean; points: number; when: { workMode?: string[]; eligibleForMe?: boolean; locationCountry?: string; locationMetro?: 'home.metros' | string[]; companyTag?: string[]; paysFloor?: boolean } }>
  feed: { defaultTiers: string[]; hideEmploymentTypes: string[]; sort: 'newest' | 'score' }
  alerts: { digestHour: number; quietHours: [number, number] | null }
}
export interface SavedPreferences { doc: PreferencesDoc; version: number; source: string; updatedAt: string; warnings: string[]; evaluated?: number; engine?: string; taskId?: string }
export interface PreferencePreset { id: string; name: string; description: string | null; system: boolean; doc: PreferencesDoc; createdAt: string }
export interface PreferencesPreview { sample: number; counts: Record<string, number>; excluded: Record<string, number>; examples: Record<string, Array<{ id: string; title: string; company: string; reasons: string[] }>>; warnings: string[] }

export interface SourceHealth {
  id: string
  name: string
  domain: string
  sourceType: string | null
  region: string | null
  country: string | null
  ingestionMethod: string
  apiUrl: string | null
  careersUrl: string | null
  companyId: string | null
  atsType: string | null
  qualityScore: number
  refreshIntervalHours: number
  lastCrawledAt: string | null
  failureCount: number
  enabled: boolean
  notes: string | null
  runnable: boolean
  availabilityIssue: string | null
  bodyHash?: string | null
  backoffUntil?: string | null
}

export interface SourcesResponse {
  data: SourceHealth[]
}

// Minimal Job type for UI (mirrors Prisma model)
export interface Job {
  id: string
  title: string
  company: string
  sourceName: string
  sourceType: string | null
  sourceUrl: string | null
  applyUrl: string | null
  country: string | null
  region: string | null
  city: string | null
  remoteType: string
  eligibility: string
  eligibilityConfidence: number | null
  eligibilityEvidence: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  salaryConfidence: number | null
  salaryInrMin: number | null
  salaryInrMax: number | null
  experienceMin: number | null
  experienceMax: number | null
  seniority: string | null
  category: string | null
  skills: string[]
  description: string | null
  /** crawl | manual (user-pasted, shown only when the crawled text is unusable) | null */
  descriptionSource?: 'crawl' | 'manual' | null
  descriptionManualAt?: string | null
  postedAt: string | null
  discoveredAt: string
  firstSeenAt: string
  lastSeenAt: string
  closedAt: string | null
  updatedAt: string | null
  livenessCheckedAt: string | null
  rankingScore: number
  baseScore: number
  status: string
  notes: string | null
  companyId: string | null
  opportunityClass: OpportunityClass
  classReason: string | null
  employmentType: EmploymentType
  /** Feed quick-match vs the candidate profile (0–100); null until a resume is uploaded. */
  matchScore?: number | null
  /** Per-user state (v3). `status` mirrors it for backwards compatibility. */
  userState?: 'saved' | 'applied' | 'rejected' | null
  /** Present on the Applied tab / job detail: what was sent. */
  application?: ApplicationSummary | null
  /** One-line "why" for the quick match. */
  matchWhy?: { matched: string[]; missing: string[] } | null
  /** C13 semantic fit (fit-v1, 0–100) and the nearest job chunks it was based on. */
  fitScore?: number | null
  fitWhy?: string[] | null
  /** Set on hybrid search results that matched by meaning. */
  searchHit?: { semantic: number } | null
  /** Per-user workflow progress for the list (v3 UI). */
  progress?: { analysed: boolean; reportScore: number | null; reportId: string | null; pendingSuggestions: number; tailored: boolean; tailoredVersionId: string | null; applied: boolean }
  /** v5: this user's evaluation from their own preferences (absent in legacy mode / before first evaluation). */
  eval?: { tier: string; tierLabel: string; score: number; eligible: boolean; reasons: string[]; components: Record<string, number> }
}

export interface ApplicationSummary {
  id: string
  status: string
  appliedAt: string | null
  /** GH-5: next reminder, or null */
  followUpAt?: string | null
  coverNote?: string | null
  resumeVersionId: string | null
  headlineUsed: string | null
  aboutUsed: string | null
  submittedVia: string
  events: Array<{ at: string; type: string; note: string | null }>
}

// ── v4: account, alerts, ops (audit NEW-07 / GH-6 / GH-3) ──────────────────────
export interface SessionRow { id: string; userAgent: string | null; ip: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean }
export interface AlertChannel { id: string; kind: 'telegram' | 'email'; address: string; classes: string[]; minScore: number; instant: boolean; digest: boolean; enabled: boolean }
export interface QueueInfo { name: string; counts: Record<string, number>; failed: Array<{ id: string | undefined; name: string; attemptsMade: number; failedReason: string; finishedOn: string | null; dataKeys: string[]; taskId: string | null; userId: string | null }> }
export interface CoverLetterSummary { id: string; text: string | null; status: string; flagged: boolean; tone: string | null }

// ── v3: resumes, profile, match ───────────────────────────────────────────────
export interface ParseWarning { code: string; severity: 'info' | 'warn' | 'error'; message: string; penalty: number }

export interface ResumeRow {
  id: string
  label: string
  isMaster: boolean
  parseStatus: 'pending' | 'parsing' | 'parsed' | 'needs_review' | 'failed'
  parseError: string | null
  parseWarnings: ParseWarning[]
  sourceFilename: string | null
  currentVersionId: string | null
  createdAt: string
  updatedAt: string
}

export interface ResumeContent {
  basics: { name: string; label?: string; email?: string; phone?: string; url?: string; summary?: string; location?: { city?: string; region?: string; countryCode?: string }; profiles: Array<{ network: string; username?: string; url?: string }> }
  work: Array<{ name: string; position: string; location?: string; url?: string; startDate?: string; endDate?: string; summary?: string; highlights: string[]; keywords: string[] }>
  education: Array<{ institution: string; area?: string; studyType?: string; startDate?: string; endDate?: string; score?: string; courses: string[] }>
  skills: Array<{ name: string; level?: string; keywords: string[] }>
  projects: Array<{ name: string; description?: string; highlights: string[]; keywords: string[]; url?: string; startDate?: string; endDate?: string }>
  certificates: Array<{ name: string; issuer?: string; date?: string; url?: string }>
  languages: Array<{ language: string; fluency?: string }>
  sections: Array<{ title: string; items: string[] }>
  meta?: { sectionOrder?: string[] }
}

export interface ResumeDetail {
  resume: ResumeRow & { rawText: string | null; sourceMime: string | null }
  current: { id: string; kind: string; content: ResumeContent; createdAt: string } | null
  versions: Array<{ id: string; kind: string; parentId: string | null; jobId: string | null; createdAt: string; renderStatus: string }>
}

export interface ApplyDefaults { noticePeriod?: string; currentLocation?: string; workAuthorization?: string; salaryExpectation?: string; linkedin?: string; portfolio?: string }

export interface CandidateProfile {
  userId: string
  headline: string | null
  about: string | null
  targetTitles: string[]
  skills: Array<{ name: string; canonical: string; confirmed?: boolean; source?: string }>
  yearsExperience: number | null
  payFloorInr: number | null
  confirmedFacts?: string[]
  applyDefaults?: ApplyDefaults
}

export type SuggestionKind = 'keyword_confirm' | 'bullet_rewrite' | 'reorder' | 'skills_section' | 'formatting' | 'headline' | 'about' | 'answer' | 'cover_letter'
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'edited' | 'answered'
export interface Suggestion {
  id: string
  reportId: string
  kind: SuggestionKind
  targetPath: string | null
  before: string | null
  after: string | null
  rationale: string
  jdEvidence: string | null
  skill: string | null
  grounding: { ok: boolean; unsupported: Array<{ kind: string; value: string }> } | null
  flagged: boolean
  expectedGain: number | null
  status: SuggestionStatus
  userEdit: string | null
  answer: { yes: boolean; context: string } | null
  variant: string | null
  question: string | null
}

export interface ResumeVersionDetail {
  id: string
  kind: string
  parentId: string | null
  jobId: string | null
  template: string
  renderStatus: 'none' | 'pending' | 'rendered' | 'failed'
  renderError: string | null
  renderWarnings: ParseWarning[] | null
  tailoredHeadline: boolean
  tailoredAbout: boolean
  /** Full document (GET /api/resume-versions/:id returns the row). */
  content?: ResumeContent
  changeLog: { changes?: Array<{ kind: string; targetPath: string | null; before: string | null; after: string }>; scoreBefore?: number | null; scoreAfter?: number | null; reportId?: string } | null
  createdAt: string
  resume: { userId: string; label: string }
  job: { id: string; title: string; company: string } | null
  reports: Array<{ id: string; score: number; scorerVersion: string }>
}

export interface ApplyKit {
  job: { id: string; title: string; company: string; applyUrl: string | null; ats: string; atsNote: string }
  version: { id: string; createdAt: string; tailoredHeadline: boolean; tailoredAbout: boolean; score: number | null; reportId: string | null } | null
  masterVersionId: string | null
  latestReport: { id: string; score: number; resumeVersionId: string } | null
  texts: { headline: string | null; about: string | null; headlineIsTailored: boolean; aboutIsTailored: boolean }
  applyDefaults: ApplyDefaults
  questions: Array<{ label: string; required: boolean; type: string; options: string[] | null; description: string | null }>
  answers: Array<{ id: string; question: string | null; answer: string | null; status: SuggestionStatus; flagged: boolean }>
  /** GH-8: grounded cover note draft (a suggestion the user edits/accepts) */
  coverLetter: CoverLetterSummary | null
  files: { pdf: string | null; docx: string | null; original: string | null; originalName: string | null }
  application: ApplicationSummary | null
}

export interface TaskState<R = unknown> {
  id: string
  type: string
  status: 'queued' | 'running' | 'done' | 'failed'
  progress: string | null
  result: R | null
  error: string | null
}

export interface ScoreComponent { points: number; max: number; note: string }
export interface AtsReport {
  id: string
  score: number
  scorerVersion: string
  createdAt: string
  job: { id: string; title: string; company: string; applyUrl: string | null }
  resumeVersion: { id: string; kind: string; resumeId: string; label: string }
  breakdown: {
    score: number
    components: Record<'requiredSkills' | 'preferredSkills' | 'title' | 'experience' | 'parseability' | 'quality' | 'keywords', ScoreComponent>
    matched: Array<{ skill: string; weight: number; where: string; strength: number; snippet?: string }>
    missing: Array<{ skill: string; weight: number; required: boolean; jdEvidence?: string; group?: string }>
    keywordsMatched: string[]
    keywordsMissing: string[]
    details: { yearsResume: number | null; yearsRequired: number | null; seniorityResume: string | null; seniorityJd: string | null; titleJd: string | null; titlesResume: string[]; stuffing: string[]; parseWarnings: string[] }
    semantic?: { version: string; model: string; fitScore: number | null; topMatches: Array<{ chunkKey: string; text: string; similarity: number }>; evidence: Array<{ skill: string; chunkKey: string; text: string; similarity: number }> } | null
  }
  requirements: { titleNormalized: string | null; seniority: string | null; yearsMin: number | null; required: Array<{ skill: string; weight: number }>; preferred: Array<{ skill: string; weight: number }>; keywords: Array<{ term: string; weight: number }>; llmUsed: boolean } | null
}

export interface CompanyRow {
  id: string
  name: string
  domain: string | null
  hqCountry: string | null
  tags: string[]
  status: string
  statusReason: string | null
  tier: string
  manualTier: string | null
  anchor: boolean
  bestClass: OpportunityClass
  classCounts180d: Record<string, number> | null
  offices: string[]
  postingRate30d: number
  activePostings: number
  lastPostingAt: string | null
  payMedianInr: number | null
  payBandStatus: string
  payConfidence: number
  discoveredVia: string
  lastProbedAt: string | null
  boards: Array<{ id: string; atsType: string; slug: string; status: string; enabled: boolean; lastPollAt: string | null; lastSuccessAt: string | null; nextPollAt: string; lastPostingCount: number; consecutiveFailures: number; lastError: string | null }>
}

export interface HostStat {
  host: string
  total: number
  rateLimited: number
  blocked: number
  errors: number
  timeouts: number
  unchanged: number
  changed: number
  rateLimitedPct: number
}

/** docs/AI-PROVIDERS.md §5: the configured LLM chain as seen by the web process. */
export interface AiStatus {
  configured: string[]
  providers: Array<{ name: string; kind: 'local' | 'cloud'; model: string | null; dataUse: 'local' | 'no-train' | 'may-train'; piiAllowed: boolean; reachable: boolean | null; detail: string | null; quota: { rpm: number; rpd: number; usedToday: number; usedMinute: number } | null; coolingDown: string | null }>
}

export interface HealthSummary {
  /** v5: preferences engine */
  prefs?: { engine: string; activeUsers: number; evaluated: number; scope: { users: number; excludedHqCountries: string[]; countries: string[]; metros: string[]; floorUsd: number | null }; suggestions: Array<{ kind: string; metro: string; label: string; boardIds: string[]; message: string }>; myTiers24h: Record<string, number> } | null
  /** audit NEW-05: worker heartbeat */
  worker?: { mode: 'bullmq' | 'inline'; alive: boolean | null; lastHeartbeatAt: string | null; staleSec: number | null; version: string | null }
  v3?: { queues: Record<string, { waiting: number; active: number; failed: number }>; llm: { calls: number; usd: number; byPurpose: Record<string, number> } | null; resumes: number; reportsToday: number; ollama?: { reachable: boolean; models: string[] }; ai?: AiStatus; embeddings?: { jobs: number; fits: number } } | null
  counts: { companies: number; watched: number; hot: number; boards: number; activeBoards: number; blockedBoards: number; failingBoards: number; pendingDiscoveries: number; openJobs: number; jobs24h: number; p1_24h: number; p2_24h: number; p3_24h: number }
  timeToDetect: { medianMinutes: number | null; samples: number }
  hosts: HostStat[]
  policies: Array<{ id: string; host: string; enabled: boolean; circuitState: string; circuitOpenUntil: string | null; tripCount7d: number; dailyBudget: number; minIntervalMs: number }>
  alerts: string[]
  problemBoards: Array<{ id: string; company: string; atsType: string; slug: string; status: string; lastError: string | null; consecutiveFailures: number; lastSuccessAt: string | null }>
  anchorsWithoutEligible: Array<{ id: string; name: string; bestClass: string; lastProbedAt: string | null }>
}

function buildQuery(filters: JobFilters): string {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  })
  return params.toString()
}

export const apiClient = {
  async getJobs(filters: JobFilters = {}): Promise<JobsResponse> {
    const res = await fetch(`/api/jobs?${buildQuery(filters)}`)
    if (!res.ok) throw new Error('Failed to fetch jobs')
    return res.json()
  },

  async getJob(id: string): Promise<Job> {
    const res = await fetch(`/api/jobs/${id}`)
    if (!res.ok) throw new Error('Failed to fetch job')
    return res.json()
  },

  async applyJob(id: string): Promise<Job> {
    const res = await fetch(`/api/jobs/${id}/apply`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to apply')
    return res.json()
  },

  async saveJob(id: string): Promise<Job> {
    const res = await fetch(`/api/jobs/${id}/save`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to save')
    return res.json()
  },

  async rejectJob(id: string): Promise<Job> {
    const res = await fetch(`/api/jobs/${id}/reject`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to reject')
    return res.json()
  },

  async triggerCrawl(): Promise<{ queued: boolean; jobId: string }> {
    const res = await fetch('/api/crawl', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to trigger crawl')
    return res.json()
  },

  async getSources(): Promise<SourcesResponse> {
    const res = await fetch('/api/sources')
    if (!res.ok) throw new Error('Failed to fetch sources')
    return res.json()
  },

  async getCompanies(params: Record<string, string | undefined> = {}): Promise<{ data: CompanyRow[]; total: number }> {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>).toString()
    const res = await fetch(`/api/companies?${qs}`)
    if (!res.ok) throw new Error('Failed to fetch companies')
    return res.json()
  },

  async patchCompany(id: string, patch: { anchor?: boolean; manualTier?: string | null; status?: string; tags?: string[] }): Promise<CompanyRow> {
    const res = await fetch(`/api/companies/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) throw new Error('Failed to update company')
    return res.json()
  },

  async addCompany(input: { name: string; careersUrl: string; hqCountry?: string; tags?: string[]; anchor?: boolean }): Promise<{ queued: boolean }> {
    const res = await fetch('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!res.ok) throw new Error('Failed to add company')
    return res.json()
  },

  async patchBoard(id: string, patch: { enabled?: boolean; status?: string }): Promise<void> {
    const res = await fetch(`/api/boards/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) throw new Error('Failed to update board')
  },

  async patchHost(id: string, patch: { enabled?: boolean; resetCircuit?: boolean }): Promise<void> {
    const res = await fetch(`/api/hosts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) throw new Error('Failed to update host')
  },

  async getHealth(): Promise<HealthSummary> {
    const res = await fetch('/api/health')
    if (!res.ok) throw new Error('Failed to fetch health')
    return res.json()
  },

  // ── v3 ──
  async getResumes(): Promise<{ data: ResumeRow[] }> {
    const res = await fetch('/api/resumes')
    if (!res.ok) throw new Error('Failed to fetch resumes')
    return res.json()
  },
  async uploadResume(file: File, label?: string): Promise<{ resume: { id: string }; taskId: string }> {
    const fd = new FormData()
    fd.set('file', file)
    if (label) fd.set('label', label)
    const res = await fetch('/api/resumes', { method: 'POST', body: fd })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Upload failed')
    return res.json()
  },
  async getResume(id: string): Promise<ResumeDetail> {
    const res = await fetch(`/api/resumes/${id}`)
    if (!res.ok) throw new Error('Failed to fetch resume')
    return res.json()
  },
  async patchResume(id: string, patch: { content?: ResumeContent; isMaster?: boolean; reparse?: boolean }): Promise<{ versionId?: string; taskId?: string }> {
    const res = await fetch(`/api/resumes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to update resume')
    return res.json()
  },
  async deleteResume(id: string): Promise<void> {
    const res = await fetch(`/api/resumes/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete resume')
  },
  async getProfile(): Promise<{ user: { id: string; email: string; name: string | null; role?: string }; profile: CandidateProfile | null }> {
    const res = await fetch('/api/profile')
    if (!res.ok) throw new Error('Failed to fetch profile')
    return res.json()
  },
  async patchProfile(patch: Partial<Pick<CandidateProfile, 'headline' | 'about' | 'targetTitles' | 'yearsExperience' | 'payFloorInr' | 'applyDefaults'>> & { skills?: Array<{ name: string }> }): Promise<{ profile: CandidateProfile }> {
    const res = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) throw new Error('Failed to update profile')
    return res.json()
  },
  async getTask<R = unknown>(id: string): Promise<TaskState<R>> {
    const res = await fetch(`/api/tasks/${id}`)
    if (!res.ok) throw new Error('Failed to fetch task')
    return res.json()
  },
  /**
   * Wait for a task: server-sent events when available (GH-1), polling otherwise. A task the server no longer
   * knows (`task_lost`, audit NEW-13) resolves as failed instead of spinning.
   */
  async waitTask<R = unknown>(id: string, onProgress?: (t: TaskState<R>) => void, intervalMs = 1500, timeoutMs = 600_000): Promise<TaskState<R>> {
    const started = Date.now()
    if (typeof EventSource !== 'undefined') {
      const viaStream = await new Promise<TaskState<R> | null>((resolve) => {
        let es: EventSource
        try { es = new EventSource(`/api/tasks/${id}/stream`) } catch { resolve(null); return }
        const finish = (v: TaskState<R> | null) => { es.close(); resolve(v) }
        const timer = setTimeout(() => finish(null), timeoutMs)
        es.addEventListener('progress', (e) => onProgress?.(JSON.parse((e as MessageEvent).data)))
        es.addEventListener('done', (e) => { clearTimeout(timer); const t = JSON.parse((e as MessageEvent).data); onProgress?.(t); finish(t) })
        es.addEventListener('failed', (e) => { clearTimeout(timer); const t = JSON.parse((e as MessageEvent).data); onProgress?.(t); finish(t) })
        es.onerror = () => { clearTimeout(timer); finish(null) } // proxy without SSE support → poll
      })
      if (viaStream) return viaStream
    }
    for (;;) {
      const t = await this.getTask<R>(id)
      onProgress?.(t)
      if (t.status === 'done' || t.status === 'failed') return t
      if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the worker — is it running?')
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  },
  async startAnalysis(jobId: string, resumeVersionId?: string): Promise<{ taskId: string; resumeVersionId: string }> {
    const res = await fetch(`/api/jobs/${jobId}/analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumeVersionId }) })
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(e.error ?? 'Failed to start analysis'), { code: e.code }) }
    return res.json()
  },
  async submitJobDescription(jobId: string, description: string): Promise<{ taskId: string }> {
    const res = await fetch(`/api/jobs/${jobId}/jd`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save description')
    return res.json()
  },
  async getLatestReport(jobId: string): Promise<{ report: AtsReport | null }> {
    const res = await fetch(`/api/jobs/${jobId}/reports`)
    if (!res.ok) throw new Error('Failed to fetch report')
    return res.json()
  },
  async getReport(id: string): Promise<AtsReport> {
    const res = await fetch(`/api/analyses/${id}`)
    if (!res.ok) throw new Error('Failed to fetch report')
    return res.json()
  },

  // ── v3 phase 3/4: suggestions, tailoring, versions, apply kit, account ──
  async getSuggestions(reportId: string): Promise<{ data: Suggestion[] }> {
    const res = await fetch(`/api/analyses/${reportId}/suggestions`)
    if (!res.ok) throw new Error('Failed to fetch suggestions')
    return res.json()
  },
  async generateSuggestions(reportId: string): Promise<{ taskId: string }> {
    const res = await fetch(`/api/analyses/${reportId}/suggestions`, { method: 'POST' })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to start suggestions')
    return res.json()
  },
  async generateVariants(reportId: string, kind: 'headline' | 'about', tone: 'conservative' | 'balanced' | 'assertive'): Promise<{ taskId: string }> {
    const res = await fetch(`/api/analyses/${reportId}/variants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, tone }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to start')
    return res.json()
  },
  async draftAnswers(reportId: string): Promise<{ taskId: string }> {
    const res = await fetch(`/api/analyses/${reportId}/answers`, { method: 'POST' })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to start')
    return res.json()
  },
  async patchSuggestion(id: string, patch: { status: SuggestionStatus; userEdit?: string | null }): Promise<Suggestion> {
    const res = await fetch(`/api/suggestions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to update suggestion')
    return res.json()
  },
  async confirmFact(id: string, yes: boolean, context?: string): Promise<{ suggestion: Suggestion; created: Suggestion[]; taskId: string | null }> {
    const res = await fetch(`/api/suggestions/${id}/confirm-fact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ yes, context }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed')
    return res.json()
  },
  async createVersion(input: { baseVersionId: string; jobId: string; acceptedSuggestionIds: string[]; headline?: string | null; about?: string | null }): Promise<{ versionId: string; taskId: string }> {
    const res = await fetch('/api/resume-versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to create version')
    return res.json()
  },
  /** Visual editor save (HLD-resume-editor): tailored version with a job, correction without. */
  async createEditorVersion(input: { baseVersionId: string; jobId?: string; content: unknown; acceptedSuggestionIds?: string[]; note?: string }): Promise<{ versionId: string; taskId: string; kind: string; changes: number; grounding: Array<{ path: string; unsupported: Array<{ kind: string; value: string }> }> }> {
    const res = await fetch('/api/resume-versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save version')
    return res.json()
  },
  async getVersion(id: string): Promise<ResumeVersionDetail> {
    const res = await fetch(`/api/resume-versions/${id}`)
    if (!res.ok) throw new Error('Failed to fetch version')
    return res.json()
  },
  async rerenderVersion(id: string): Promise<{ taskId: string }> {
    const res = await fetch(`/api/resume-versions/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rerender: true }) })
    if (!res.ok) throw new Error('Failed to re-render')
    return res.json()
  },
  async getApplyKit(jobId: string): Promise<ApplyKit> {
    const res = await fetch(`/api/jobs/${jobId}/apply-kit`)
    if (!res.ok) throw new Error('Failed to fetch apply kit')
    return res.json()
  },
  async recordApplication(jobId: string, body: { resumeVersionId?: string | null; headlineUsed?: string | null; aboutUsed?: string | null; coverNote?: string | null; answers?: Array<{ question: string; answer: string }>; status?: string; note?: string; followUpAt?: string | null; followUpInDays?: number }): Promise<Job> {
    const res = await fetch(`/api/jobs/${jobId}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to record application')
    return res.json()
  },
  async me(): Promise<{ user: { id: string; email: string; name: string | null; role: string } | null }> {
    const res = await fetch('/api/auth/me')
    return res.ok ? res.json() : { user: null }
  },
  async logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' })
  },
  async deleteAccount(confirmEmail: string): Promise<void> {
    const res = await fetch('/api/me', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: confirmEmail }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to delete account')
  },

  // ── v4 ──────────────────────────────────────────────────────────────────────
  async changePassword(current: string, next: string): Promise<void> {
    const res = await fetch('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, next }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to change password')
  },
  async getSessions(): Promise<{ data: SessionRow[] }> {
    const res = await fetch('/api/auth/sessions')
    if (!res.ok) throw new Error('Failed to load sessions')
    return res.json()
  },
  async revokeSession(id: string): Promise<void> { await fetch(`/api/auth/sessions/${id}`, { method: 'DELETE' }) },
  async revokeOtherSessions(): Promise<void> { await fetch('/api/auth/sessions', { method: 'DELETE' }) },
  async getAlertChannels(): Promise<{ data: AlertChannel[]; providers: { telegram: boolean; email: boolean }; envFallback: boolean }> {
    const res = await fetch('/api/alert-channels')
    if (!res.ok) throw new Error('Failed to load alert channels')
    return res.json()
  },
  async addAlertChannel(input: { kind: 'telegram' | 'email'; address: string; classes?: string[]; minScore?: number }): Promise<AlertChannel> {
    const res = await fetch('/api/alert-channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to add channel')
    return res.json()
  },
  async patchAlertChannel(id: string, patch: Partial<Pick<AlertChannel, 'classes' | 'minScore' | 'instant' | 'digest' | 'enabled'>>): Promise<AlertChannel> {
    const res = await fetch(`/api/alert-channels/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) throw new Error('Failed to update channel')
    return res.json()
  },
  async deleteAlertChannel(id: string): Promise<void> { await fetch(`/api/alert-channels/${id}`, { method: 'DELETE' }) },
  async draftCoverLetter(reportId: string, tone: 'conservative' | 'balanced' | 'assertive' = 'balanced'): Promise<{ taskId: string }> {
    const res = await fetch(`/api/analyses/${reportId}/cover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tone }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to draft cover note')
    return res.json()
  },
  async getQueues(): Promise<{ mode: string; queues: QueueInfo[] }> {
    const res = await fetch('/api/admin/queues')
    if (!res.ok) throw new Error('Failed to load queues')
    return res.json()
  },
  async queueAction(queue: string, action: 'retry' | 'remove' | 'clean', jobId?: string): Promise<void> {
    const res = await fetch('/api/admin/queues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queue, action, jobId }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Queue action failed')
  },

  // ── v5: preferences ──────────────────────────────────────────────────────────
  async getPreferences(): Promise<SavedPreferences> {
    const res = await fetch('/api/preferences')
    if (!res.ok) throw new Error('Failed to load preferences')
    return res.json()
  },
  async savePreferences(doc: PreferencesDoc, note?: string): Promise<SavedPreferences> {
    const res = await fetch('/api/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc, note }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save preferences')
    return res.json()
  },
  async previewPreferences(doc: PreferencesDoc): Promise<PreferencesPreview> {
    const res = await fetch('/api/preferences/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Preview failed')
    return res.json()
  },
  async getPresets(): Promise<{ data: PreferencePreset[] }> {
    const res = await fetch('/api/preferences/presets')
    if (!res.ok) throw new Error('Failed to load presets')
    return res.json()
  },
  async savePreset(name: string, doc: PreferencesDoc, description?: string): Promise<{ id: string }> {
    const res = await fetch('/api/preferences/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, doc, description }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save preset')
    return res.json()
  },
  async deletePreset(id: string): Promise<void> { await fetch(`/api/preferences/presets/${id}`, { method: 'DELETE' }) },
  async applyPreset(id: string, replaceHome = false): Promise<SavedPreferences> {
    const res = await fetch(`/api/preferences/presets/${id}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replaceHome }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to apply preset')
    return res.json()
  },
  async getPreferencesHistory(): Promise<{ data: Array<{ id: string; version: number; source: string; note: string | null; changedAt: string }> }> {
    const res = await fetch('/api/preferences/history')
    if (!res.ok) throw new Error('Failed to load history')
    return res.json()
  },
  async revertPreferences(version: number): Promise<SavedPreferences> {
    const res = await fetch('/api/preferences/revert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to revert')
    return res.json()
  },
  async applyCrawlScope(metro: string, boardIds?: string[]): Promise<{ applied: number }> {
    const res = await fetch('/api/admin/crawl-scope', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metro, boardIds }) })
    if (!res.ok) throw new Error('Failed to apply crawl scope')
    return res.json()
  },
  // ── browser extension pairing ────────────────────────────────────────────────
  async pairExtension(label?: string): Promise<{ token: string; expiresAt: string | null; baseUrl: string }> {
    const res = await fetch('/api/ext/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to create extension token')
    return res.json()
  },
  async getExtensionTokens(): Promise<{ data: Array<{ id: string; createdAt: string; expiresAt: string }> }> {
    const res = await fetch('/api/ext/pair')
    if (!res.ok) throw new Error('Failed to load extension tokens')
    return res.json()
  },
  async revokeExtensionToken(id?: string): Promise<void> {
    await fetch('/api/ext/pair', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id ? { id } : {}) })
  },
}
