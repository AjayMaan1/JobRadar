/**
 * In-memory Prisma Client double covering the query surface used by JobRadar services.
 * Supports: findMany/findUnique/findFirst/create/update/updateMany/upsert/deleteMany/count/groupBy,
 * where operators (equals/in/notIn/not/contains/gte/gt/lte/lt/mode/OR/AND, to-one + to-many relation
 * filters), orderBy (incl. relation), include/select, cursor/skip/take, compound uniques, increments,
 * $queryRaw for the dispatcher SQL, $transaction(callback).
 */
import { randomUUID } from 'node:crypto'

type Row = Record<string, any>

interface ModelDef {
  table: string
  uniques: string[][]
  defaults: () => Row
  relations?: Record<string, { kind: 'one' | 'many'; model: string; localKey?: string; foreignKey?: string; targetKey?: string }>
}

const MODELS: Record<string, ModelDef> = {
  job: {
    table: 'jobs',
    uniques: [['id'], ['canonicalHash']],
    defaults: () => ({ remoteType: 'unknown', eligibility: 'unknown', rankingScore: 0, baseScore: 0, status: 'new', employmentType: 'unknown', opportunityClass: 'none', discoveredAt: new Date(), firstSeenAt: new Date(), lastSeenAt: new Date(), updatedAt: new Date(), closedAt: null, companyId: null, classReason: null, livenessCheckedAt: null, postedAt: null, description: null, applyUrl: null, sourceUrl: null, descriptionManual: null, descriptionManualBy: null, descriptionManualAt: null, experienceMin: null, experienceMax: null, salaryUsdMin: null, salaryUsdMax: null, salaryInrMin: null, salaryInrMax: null, salaryMin: null, salaryMax: null, salaryCurrency: null, seniority: null, category: null, eligibility: 'unknown', region: null, city: null, country: null }),
    relations: {
      companyRef: { kind: 'one', model: 'company', localKey: 'companyId' },
      sightings: { kind: 'many', model: 'jobSighting', foreignKey: 'jobId' },
      applications: { kind: 'many', model: 'application', foreignKey: 'jobId' },
      notifications: { kind: 'many', model: 'notification', foreignKey: 'jobId' },
      payEvidence: { kind: 'many', model: 'payEvidence', foreignKey: 'jobId' },
      userStates: { kind: 'many', model: 'jobUserState', foreignKey: 'jobId' },
      requirements: { kind: 'one', model: 'jobRequirements', localKey: 'id', targetKey: 'jobId' },
      resumeVersions: { kind: 'many', model: 'resumeVersion', foreignKey: 'jobId' },
      atsReports: { kind: 'many', model: 'atsReport', foreignKey: 'jobId' },
      fits: { kind: 'many', model: 'jobFit', foreignKey: 'jobId' },
      facts: { kind: 'one', model: 'jobFacts', localKey: 'id', targetKey: 'jobId' },
      evals: { kind: 'many', model: 'jobUserEval', foreignKey: 'jobId' },
    },
  },
  // v5 dynamic preferences
  jobFacts: { table: 'job_facts', uniques: [['jobId']], defaults: () => ({ updatedAt: new Date() }), relations: { job: { kind: 'one', model: 'job', localKey: 'jobId' } } },
  userPreferences: { table: 'user_preferences', uniques: [['userId']], defaults: () => ({ schemaVersion: 1, source: 'preset', version: 1, updatedAt: new Date() }), relations: { user: { kind: 'one', model: 'user', localKey: 'userId' } } },
  preferencePreset: { table: 'preference_presets', uniques: [['id'], ['ownerUserId', 'name']], defaults: () => ({ ownerUserId: null, description: null, schemaVersion: 1, createdAt: new Date() }), relations: { owner: { kind: 'one', model: 'user', localKey: 'ownerUserId' } } },
  preferenceHistory: { table: 'preference_history', uniques: [['id'], ['userId', 'version']], defaults: () => ({ note: null, changedAt: new Date() }), relations: { user: { kind: 'one', model: 'user', localKey: 'userId' } } },
  jobUserEval: { table: 'job_user_evals', uniques: [['userId', 'jobId']], defaults: () => ({ evaluatedAt: new Date() }), relations: { job: { kind: 'one', model: 'job', localKey: 'jobId' }, user: { kind: 'one', model: 'user', localKey: 'userId' } } },
  // v3c semantic layer
  embedding: { table: 'embeddings', uniques: [['id'], ['ownerType', 'ownerId', 'chunkKey', 'model']], defaults: () => ({ createdAt: new Date(), updatedAt: new Date() }) },
  jobFit: { table: 'job_fits', uniques: [['userId', 'jobId']], defaults: () => ({ keywordScore: null, topMatches: null, updatedAt: new Date() }), relations: { job: { kind: 'one', model: 'job', localKey: 'jobId' }, user: { kind: 'one', model: 'user', localKey: 'userId' } } },
  // v3 models (minimal defaults; enough for the dashboard/E2E paths)
  user: { table: 'users', uniques: [['id'], ['email']], defaults: () => ({ name: null, role: 'user', passwordHash: null, createdAt: new Date(), lastLoginAt: null, emailVerifiedAt: null }), relations: { preferences: { kind: 'one', model: 'userPreferences', localKey: 'id', targetKey: 'userId' }, evals: { kind: 'many', model: 'jobUserEval', foreignKey: 'userId' }, authTokens: { kind: 'many', model: 'authToken', foreignKey: 'userId' }, alertChannels: { kind: 'many', model: 'alertChannel', foreignKey: 'userId' }, profile: { kind: 'one', model: 'candidateProfile', localKey: 'id', targetKey: 'userId' }, sessions: { kind: 'many', model: 'session', foreignKey: 'userId' }, jobStates: { kind: 'many', model: 'jobUserState', foreignKey: 'userId' }, applications: { kind: 'many', model: 'application', foreignKey: 'userId' }, resumes: { kind: 'many', model: 'resume', foreignKey: 'userId' }, fits: { kind: 'many', model: 'jobFit', foreignKey: 'userId' } } },
  authToken: { table: 'auth_tokens', uniques: [['id'], ['tokenHash']], defaults: () => ({ usedAt: null, createdAt: new Date() }), relations: { user: { kind: 'one', model: 'user', localKey: 'userId' } } },
  alertChannel: { table: 'alert_channels', uniques: [['id'], ['userId', 'kind', 'address']], defaults: () => ({ classes: ['p1_global_remote', 'p2_india_remote'], minScore: 0, instant: true, digest: true, enabled: true, createdAt: new Date(), updatedAt: new Date() }), relations: { user: { kind: 'one', model: 'user', localKey: 'userId' } } },
  session: { table: 'sessions', uniques: [['id'], ['tokenHash']], defaults: () => ({ userAgent: null, ip: null, createdAt: new Date(), lastSeenAt: new Date() }), relations: { user: { kind: 'one', model: 'user', localKey: 'userId' } } },
  candidateProfile: { table: 'candidate_profiles', uniques: [['userId']], defaults: () => ({ headline: null, about: null, targetTitles: [], skills: [], yearsExperience: null, payFloorInr: null, confirmedFacts: [], applyDefaults: {}, createdAt: new Date(), updatedAt: new Date() }) },
  jobUserState: { table: 'job_user_states', uniques: [['userId', 'jobId']], defaults: () => ({ matchScore: null, updatedAt: new Date() }), relations: { job: { kind: 'one', model: 'job', localKey: 'jobId' }, user: { kind: 'one', model: 'user', localKey: 'userId' } } },
  resume: { table: 'resumes', uniques: [['id']], defaults: () => ({ isMaster: false, sourceFileKey: null, sourceMime: null, sourceFilename: null, parseStatus: 'pending', parseError: null, parseWarnings: [], rawText: null, currentVersionId: null, createdAt: new Date(), updatedAt: new Date() }), relations: { versions: { kind: 'many', model: 'resumeVersion', foreignKey: 'resumeId' }, user: { kind: 'one', model: 'user', localKey: 'userId' } } },
  resumeVersion: { table: 'resume_versions', uniques: [['id']], defaults: () => ({ parentId: null, jobId: null, kind: 'master', template: 'ats-classic', pdfKey: null, docxKey: null, renderStatus: 'none', tailoredHeadline: false, tailoredAbout: false, changeLog: null, renderError: null, renderWarnings: null, renderedAt: null, createdAt: new Date() }), relations: { resume: { kind: 'one', model: 'resume', localKey: 'resumeId' }, job: { kind: 'one', model: 'job', localKey: 'jobId' }, reports: { kind: 'many', model: 'atsReport', foreignKey: 'resumeVersionId' }, applications: { kind: 'many', model: 'application', foreignKey: 'resumeVersionId' }, children: { kind: 'many', model: 'resumeVersion', foreignKey: 'parentId' } } },
  jobRequirements: { table: 'job_requirements', uniques: [['jobId']], defaults: () => ({ descriptionSource: 'crawl', titleNormalized: null, seniority: null, yearsMin: null, required: [], preferred: [], keywords: [], applicationQuestions: null, llmUsed: false, createdAt: new Date(), updatedAt: new Date() }) },
  atsReport: { table: 'ats_reports', uniques: [['id'], ['resumeVersionId', 'jobId', 'scorerVersion']], defaults: () => ({ createdAt: new Date() }), relations: { resumeVersion: { kind: 'one', model: 'resumeVersion', localKey: 'resumeVersionId' }, job: { kind: 'one', model: 'job', localKey: 'jobId' }, suggestions: { kind: 'many', model: 'suggestion', foreignKey: 'reportId' } } },
  suggestion: { table: 'suggestions', uniques: [['id']], defaults: () => ({ targetPath: null, before: null, after: null, jdEvidence: null, skill: null, grounding: null, flagged: false, expectedGain: null, status: 'pending', userEdit: null, answer: null, variant: null, question: null, createdAt: new Date(), updatedAt: new Date() }), relations: { report: { kind: 'one', model: 'atsReport', localKey: 'reportId' } } },
  source: { table: 'sources', uniques: [['id'], ['domain']], defaults: () => ({ qualityScore: 50, refreshIntervalHours: 8, failureCount: 0, enabled: true, etag: null, lastModified: null, bodyHash: null, backoffUntil: null, availabilityIssue: null, lastCrawledAt: null, sourceType: null, apiUrl: null, careersUrl: null, atsType: null, companyId: null, region: null, country: null, notes: null }) },
  application: { table: 'applications', uniques: [['id'], ['userId', 'jobId']], defaults: () => ({ status: 'applied', userId: null, appliedAt: null, followUpAt: null, resumeVersion: null, coverLetterVersion: null, notes: null, resumeVersionId: null, headlineUsed: null, aboutUsed: null, coverNote: null, answers: null, submittedVia: 'manual', events: [] }), relations: { job: { kind: 'one', model: 'job', localKey: 'jobId' }, user: { kind: 'one', model: 'user', localKey: 'userId' }, resumeVersionRef: { kind: 'one', model: 'resumeVersion', localKey: 'resumeVersionId' } } },
  notification: { table: 'notifications', uniques: [['id']], defaults: () => ({ status: 'pending', sentAt: null, error: null, jobId: null, canonicalHash: null, score: null, recipient: null, payload: null }) },
  company: {
    table: 'companies',
    uniques: [['id'], ['domain']],
    defaults: () => ({ domain: null, hqCountry: null, tags: [], hiresIn: [], eligibilityConfidence: 0, engineeringShare: 0, postingRate30d: 0, activePostings: 0, lastPostingAt: null, payConfidence: 0, payEvidenceCount: 0, payBandStatus: 'unknown', payMedianInr: null, payMinInr: null, payMaxInr: null, payLastAt: null, bestClass: 'none', classCounts180d: null, offices: [], anchor: false, status: 'discovered', statusReason: null, tier: 'cold', tierReason: null, tierUpdatedAt: null, manualTier: null, qualityScore: 0, discoveredAt: new Date(), firstQualifiedAt: null, lastProbedAt: null, notes: null, createdAt: new Date(), updatedAt: new Date() }),
    relations: {
      boards: { kind: 'many', model: 'companyBoard', foreignKey: 'companyId' },
      discoveries: { kind: 'many', model: 'companyDiscovery', foreignKey: 'companyId' },
      payEvidence: { kind: 'many', model: 'payEvidence', foreignKey: 'companyId' },
      jobs: { kind: 'many', model: 'job', foreignKey: 'companyId' },
    },
  },
  companyBoard: {
    table: 'company_boards',
    uniques: [['id'], ['atsType', 'slug']],
    defaults: () => ({ careersUrl: null, queryScope: null, status: 'active', enabled: true, nextPollAt: new Date(), lastPollAt: null, lastSuccessAt: null, lastChangedAt: null, backoffUntil: null, etag: null, lastModified: null, bodyHash: null, consecutiveFailures: 0, consecutiveUnchanged: 0, blockedCount7d: 0, lastStatusCode: null, lastError: null, lastPostingCount: 0, suspectDropAt: null, createdAt: new Date(), updatedAt: new Date() }),
    relations: {
      company: { kind: 'one', model: 'company', localKey: 'companyId' },
      sightings: { kind: 'many', model: 'jobSighting', foreignKey: 'boardId' },
      fetchRuns: { kind: 'many', model: 'fetchRun', foreignKey: 'boardId' },
    },
  },
  companyDiscovery: { table: 'company_discoveries', uniques: [['id'], ['source', 'externalRef']], defaults: () => ({ companyId: null, nameAsSeen: null, domainAsSeen: null, careersUrlAsSeen: null, atsHint: null, slugHint: null, payload: null, firstSeenAt: new Date(), lastSeenAt: new Date(), seenCount: 1, resolution: 'pending', resolvedAt: null, resolutionNote: null }), relations: { company: { kind: 'one', model: 'company', localKey: 'companyId' } } },
  payEvidence: { table: 'pay_evidence', uniques: [['id']], defaults: () => ({ jobId: null, confidence: 0.5, createdAt: new Date() }), relations: { company: { kind: 'one', model: 'company', localKey: 'companyId' } } },
  jobSighting: {
    table: 'job_sightings',
    uniques: [['id'], ['feedKey', 'externalId']],
    defaults: () => ({ boardId: null, sourceId: null, jobId: null, firstSeenAt: new Date(), lastSeenAt: new Date(), missingCount: 0, goneAt: null, postedAtSrc: null, detailFetchedAt: null }),
    relations: { board: { kind: 'one', model: 'companyBoard', localKey: 'boardId' }, job: { kind: 'one', model: 'job', localKey: 'jobId' }, source: { kind: 'one', model: 'source', localKey: 'sourceId' } },
  },
  fetchRun: { table: 'fetch_runs', uniques: [['id']], defaults: () => ({ boardId: null, sourceId: null, startedAt: new Date(), newCount: 0, changedCount: 0, goneCount: 0, errorClass: null, errorMessage: null }) },
  hostPolicy: { table: 'host_policies', uniques: [['id'], ['host']], defaults: () => ({ enabled: true, maxConcurrency: 2, minIntervalMs: 1000, burst: 3, dailyBudget: 20000, probeBudgetPerDay: 300, respectRobots: true, circuitState: 'closed', circuitOpenUntil: null, circuitOpenedAt: null, tripCount7d: 0, notes: null, updatedAt: new Date() }) },
  recruiter: { table: 'recruiters', uniques: [['id']], defaults: () => ({}) },
}

const COMPOUND_KEYS: Record<string, string[]> = {
  feedKey_externalId: ['feedKey', 'externalId'],
  userId_jobId: ['userId', 'jobId'],
  resumeVersionId_jobId_scorerVersion: ['resumeVersionId', 'jobId', 'scorerVersion'],
  atsType_slug: ['atsType', 'slug'],
  source_externalRef: ['source', 'externalRef'],
  ownerType_ownerId_chunkKey_model: ['ownerType', 'ownerId', 'chunkKey', 'model'],
  ownerUserId_name: ['ownerUserId', 'name'],
  userId_version: ['userId', 'version'],
  userId_kind_address: ['userId', 'kind', 'address'],
}

export class PrismaConflictError extends Error {
  code = 'P2002'
}

function cmp(a: any, b: any): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0)
  return String(a).localeCompare(String(b))
}

export class FakePrisma {
  private store = new Map<string, Row[]>()
  public log: Array<{ model: string; op: string }> = []

  constructor() {
    for (const m of Object.keys(MODELS)) {
      this.store.set(m, [])
      ;(this as any)[m] = this.delegate(m)
    }
  }

  /** Raw access for assertions. */
  rows(model: string): Row[] {
    return this.store.get(model)!
  }

  reset() {
    for (const m of Object.keys(MODELS)) this.store.set(m, [])
  }

  async $transaction(arg: any): Promise<any> {
    if (typeof arg === 'function') return arg(this)
    return Promise.all(arg)
  }

  async $disconnect() {}

  /** Only the dispatcher SQL is supported: claim due boards / lag. */
  async $queryRaw(strings: TemplateStringsArray, ...values: any[]): Promise<any[]> {
    const sql = strings.join('?')
    if (/UPDATE company_boards/.test(sql)) {
      const limit = values[0] ?? 200
      const lease = values[1] ?? 10
      const boards = this.rows('companyBoard')
      const companies = this.rows('company')
      const tierRank: Record<string, number> = { hot: 0, warm: 1, cold: 2, dormant: 3 }
      const now = Date.now()
      const due = boards
        .map((b) => ({ b, c: companies.find((c) => c.id === b.companyId) }))
        .filter(({ b, c }) => c && b.enabled && ['active', 'failing'].includes(b.status) && b.nextPollAt.getTime() <= now && (!b.backoffUntil || b.backoffUntil.getTime() <= now) && ['watched', 'probing', 'dormant'].includes(c.status))
        .sort((x, y) => (tierRank[x.c!.manualTier ?? x.c!.tier] - tierRank[y.c!.manualTier ?? y.c!.tier]) || (x.b.nextPollAt.getTime() - y.b.nextPollAt.getTime()))
        .slice(0, limit)
      for (const { b } of due) b.nextPollAt = new Date(now + lease * 60_000)
      return due.map(({ b }) => ({ id: b.id }))
    }
    if (/EXTRACT\(EPOCH/.test(sql)) {
      const now = Date.now()
      const companies = this.rows('company')
      const due = this.rows('companyBoard').filter((b) => { const c = companies.find((c) => c.id === b.companyId); return c && b.enabled && ['active', 'failing'].includes(b.status) && b.nextPollAt.getTime() <= now && ['watched', 'probing'].includes(c.status) })
      if (!due.length) return [{ lag: null }]
      return [{ lag: (now - Math.min(...due.map((b) => b.nextPollAt.getTime()))) / 1000 }]
    }
    throw new Error(`FakePrisma.$queryRaw: unsupported SQL: ${sql.slice(0, 80)}`)
  }

  // ───────────────────────── where evaluation ─────────────────────────
  private matchValue(actual: any, cond: any): boolean {
    if (cond === null) return actual === null || actual === undefined
    if (cond instanceof Date || typeof cond !== 'object' || Array.isArray(cond)) {
      if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime()
      return actual === cond
    }
    const insensitive = cond.mode === 'insensitive'
    const norm = (v: any) => (insensitive && typeof v === 'string' ? v.toLowerCase() : v)
    for (const [op, v] of Object.entries(cond)) {
      switch (op) {
        case 'mode': break
        case 'equals': if (norm(actual) !== norm(v)) return false; break
        case 'in': if (!(v as any[]).some((x) => norm(x) === norm(actual))) return false; break
        case 'notIn': if ((v as any[]).some((x) => norm(x) === norm(actual))) return false; break
        case 'not': if (this.matchValue(actual, v)) return false; break
        case 'contains': if (typeof actual !== 'string' || !norm(actual).includes(norm(v))) return false; break
        case 'startsWith': if (typeof actual !== 'string' || !norm(actual).startsWith(norm(v))) return false; break
        case 'gte': if (!(cmp(actual, v) >= 0) || actual == null) return false; break
        case 'gt': if (!(cmp(actual, v) > 0) || actual == null) return false; break
        case 'lte': if (!(cmp(actual, v) <= 0) || actual == null) return false; break
        case 'lt': if (!(cmp(actual, v) < 0) || actual == null) return false; break
        case 'has': if (!Array.isArray(actual) || !actual.includes(v)) return false; break
        default: throw new Error(`FakePrisma: unsupported operator ${op}`)
      }
    }
    return true
  }

  private matches(model: string, row: Row, where: Row | undefined): boolean {
    if (!where) return true
    const def = MODELS[model]
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'AND') { const arr = Array.isArray(cond) ? cond : [cond]; if (!arr.every((w) => this.matches(model, row, w))) return false; continue }
      if (key === 'OR') { if (!(cond as Row[]).some((w) => this.matches(model, row, w))) return false; continue }
      if (key === 'NOT') { const arr = Array.isArray(cond) ? cond : [cond]; if (arr.some((w) => this.matches(model, row, w))) return false; continue }
      const rel = def.relations?.[key]
      if (rel) {
        if (rel.kind === 'one') {
          const target = this.rows(rel.model).find((r) => r[rel.targetKey ?? 'id'] === row[rel.localKey!])
          if (cond === null) { if (target) return false; continue }
          if (!target || !this.matches(rel.model, target, cond as Row)) return false
          continue
        }
        const children = this.rows(rel.model).filter((r) => r[rel.foreignKey!] === row.id)
        const c = cond as Row
        if ('none' in c && children.some((ch) => this.matches(rel.model, ch, c.none))) return false
        if ('some' in c && !children.some((ch) => this.matches(rel.model, ch, c.some))) return false
        if ('every' in c && !children.every((ch) => this.matches(rel.model, ch, c.every))) return false
        continue
      }
      if (COMPOUND_KEYS[key]) { if (!COMPOUND_KEYS[key].every((f) => row[f] === (cond as Row)[f])) return false; continue }
      if (!this.matchValue(row[key], cond)) return false
    }
    return true
  }

  private sort(model: string, rows: Row[], orderBy: any): Row[] {
    if (!orderBy) return rows
    const list = Array.isArray(orderBy) ? orderBy : [orderBy]
    const def = MODELS[model]
    const get = (row: Row, spec: Row): [any, string] => {
      const [k, v] = Object.entries(spec)[0]
      if (typeof v === 'object' && v !== null && !('sort' in v)) {
        const rel = def.relations?.[k]
        const target = rel ? this.rows(rel.model).find((r) => r.id === row[rel.localKey!]) : null
        const [k2, dir] = Object.entries(v)[0]
        return [target?.[k2], dir as string]
      }
      const dir = typeof v === 'object' && v !== null ? (v as any).sort : v
      return [row[k], dir]
    }
    return [...rows].sort((a, b) => {
      for (const spec of list) {
        const [va, dir] = get(a, spec)
        const [vb] = get(b, spec)
        const c = cmp(va, vb)
        if (c !== 0) return dir === 'desc' ? -c : c
      }
      return 0
    })
  }

  private project(model: string, row: Row, args: { select?: Row; include?: Row }): Row {
    const def = MODELS[model]
    let out: Row = args.select ? Object.fromEntries(Object.entries(args.select).filter(([k, v]) => v && !def.relations?.[k]).map(([k]) => [k, row[k]])) : { ...row }
    const relSpecs = { ...(args.include ?? {}), ...(args.select ? Object.fromEntries(Object.entries(args.select).filter(([k]) => def.relations?.[k] || k === '_count')) : {}) }
    for (const [k, spec] of Object.entries(relSpecs)) {
      if (!spec) continue
      if (k === '_count') {
        // `_count: { select: { rel: true | { where } } }` — relation counts (to-many only)
        const sel = (typeof spec === 'object' && (spec as Row).select) || {}
        out._count = Object.fromEntries(Object.entries(sel).filter(([, v]) => v).map(([rk, v]) => {
          const rel = def.relations?.[rk]
          if (!rel || rel.kind !== 'many') throw new Error(`FakePrisma: _count on unknown/to-one relation ${model}.${rk}`)
          let children = this.rows(rel.model).filter((r) => r[rel.foreignKey!] === row.id)
          const w = typeof v === 'object' ? (v as Row).where : undefined
          if (w) children = children.filter((c) => this.matches(rel.model, c, w))
          return [rk, children.length]
        }))
        continue
      }
      const rel = def.relations?.[k]
      if (!rel) throw new Error(`FakePrisma: unknown relation ${model}.${k}`)
      const sub = typeof spec === 'object' ? (spec as Row) : {}
      if (rel.kind === 'one') {
        const target = this.rows(rel.model).find((r) => r[rel.targetKey ?? 'id'] === row[rel.localKey!])
        out[k] = target ? this.project(rel.model, target, sub) : null
      } else {
        let children = this.rows(rel.model).filter((r) => r[rel.foreignKey!] === row.id)
        if (sub.where) children = children.filter((c) => this.matches(rel.model, c, sub.where))
        children = this.sort(rel.model, children, sub.orderBy)
        if (sub.take) children = children.slice(0, sub.take)
        out[k] = children.map((c) => this.project(rel.model, c, sub))
      }
    }
    return out
  }

  private applyData(model: string, row: Row, data: Row): void {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue
      if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && ('increment' in v || 'decrement' in v || 'set' in v)) {
        if ('increment' in v) row[k] = (row[k] ?? 0) + v.increment
        if ('decrement' in v) row[k] = (row[k] ?? 0) - v.decrement
        if ('set' in v) row[k] = v.set
        continue
      }
      row[k] = v
    }
    if ('updatedAt' in MODELS[model].defaults()) row.updatedAt = new Date()
  }

  private checkUniques(model: string, row: Row, ignoreId?: string) {
    for (const u of MODELS[model].uniques) {
      if (u.some((f) => row[f] === null || row[f] === undefined)) continue
      const clash = this.rows(model).find((r) => r.id !== ignoreId && u.every((f) => r[f] === row[f]))
      if (clash) throw new PrismaConflictError(`Unique constraint failed on ${model}(${u.join(',')})`)
    }
  }

  private delegate(model: string) {
    const self = this
    const find = (args: Row = {}) => {
      let rows = self.rows(model).filter((r) => self.matches(model, r, args.where))
      rows = self.sort(model, rows, args.orderBy)
      if (args.cursor) { const idx = rows.findIndex((r) => r.id === args.cursor.id); rows = idx >= 0 ? rows.slice(idx) : [] }
      if (args.distinct) { const seen = new Set<string>(); const fields: string[] = Array.isArray(args.distinct) ? args.distinct : [args.distinct]; rows = rows.filter((r) => { const k = fields.map((f) => JSON.stringify(r[f])).join('|'); if (seen.has(k)) return false; seen.add(k); return true }) }
      if (args.skip) rows = rows.slice(args.skip)
      if (args.take) rows = rows.slice(0, args.take)
      return rows
    }
    return {
      async findMany(args: Row = {}) { self.log.push({ model, op: 'findMany' }); return find(args).map((r) => self.project(model, r, args)) },
      async findFirst(args: Row = {}) { const r = find({ ...args, take: 1 })[0]; return r ? self.project(model, r, args) : null },
      async findUnique(args: Row) { const r = find({ where: args.where })[0]; return r ? self.project(model, r, args) : null },
      async findUniqueOrThrow(args: Row) { const r = find({ where: args.where })[0]; if (!r) throw new Error('NotFound'); return self.project(model, r, args) },
      async count(args: Row = {}) { return find(args).length },
      async create(args: Row) {
        const row: Row = { id: randomUUID(), ...MODELS[model].defaults() }
        self.applyData(model, row, args.data)
        self.checkUniques(model, row)
        self.rows(model).push(row)
        return self.project(model, row, args)
      },
      async createMany(args: Row) { for (const d of args.data) await this.create({ data: d }); return { count: args.data.length } },
      async update(args: Row) {
        const row = find({ where: args.where })[0]
        if (!row) throw new Error(`FakePrisma: ${model}.update record not found`)
        self.applyData(model, row, args.data)
        self.checkUniques(model, row, row.id)
        return self.project(model, row, args)
      },
      async updateMany(args: Row) { const rows = find({ where: args.where }); for (const r of rows) self.applyData(model, r, args.data); return { count: rows.length } },
      async upsert(args: Row) {
        const row = find({ where: args.where })[0]
        if (row) return this.update({ where: args.where, data: args.update, include: args.include })
        return this.create({ data: args.create, include: args.include })
      },
      async delete(args: Row) { const row = find({ where: args.where })[0]; if (row) self.store.set(model, self.rows(model).filter((r) => r !== row)); return row },
      async deleteMany(args: Row = {}) { const rows = find({ where: args.where }); self.store.set(model, self.rows(model).filter((r) => !rows.includes(r))); return { count: rows.length } },
      async groupBy(args: Row) {
        const rows = find({ where: args.where })
        const groups = new Map<string, Row>()
        for (const r of rows) {
          const key = args.by.map((k: string) => r[k]).join('|')
          if (!groups.has(key)) groups.set(key, { ...Object.fromEntries(args.by.map((k: string) => [k, r[k]])), _count: { _all: 0 } })
          groups.get(key)!._count._all++
        }
        return [...groups.values()]
      },
    }
  }
}

export function createFakePrisma(): FakePrisma & Record<string, any> {
  return new FakePrisma() as any
}
