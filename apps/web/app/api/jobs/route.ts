import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import type { Prisma } from '@jobradar/db'
import { expandQuery, quickMatchDetail } from '@jobradar/resume'
import { serializeJob } from '../../../lib/job-serializer'
import type { Job } from '../../../lib/api-client'
import { authErrorResponse, requireUser } from '../../../lib/auth'
import { semanticCandidates, services } from '../../../lib/services'
import { fuse, lexicalCandidates } from '../../../lib/search'
import { log } from '@jobradar/log'
import { LEGACY_CLASS_TO_TIER, type Preferences } from '@jobradar/prefs'

const ENGINE = (): 'evals' | 'legacy' => (process.env.PREFS_ENGINE === 'legacy' ? 'legacy' : 'evals')

const CLASSES = ['p1_global_remote', 'p2_india_remote', 'p3_ncr_hybrid', 'none'] as const
const ELIGIBLE = ['p1_global_remote', 'p2_india_remote', 'p3_ncr_hybrid'] as const
/** sort=match ranks in memory over the most recent N candidates (quick match is computed in JS, not SQL). */
const MATCH_SORT_WINDOW = 600

const jobInclude = (userId: string) =>
  ({
    userStates: { where: { userId }, select: { state: true } },
    applications: { where: { userId } },
    atsReports: { where: { resumeVersion: { resume: { userId } } }, orderBy: { createdAt: 'desc' as const }, take: 1, select: { id: true, score: true, _count: { select: { suggestions: { where: { status: 'pending' } } } } } },
    resumeVersions: { where: { kind: 'tailored', renderStatus: 'rendered', resume: { userId } }, orderBy: { createdAt: 'desc' as const }, take: 1, select: { id: true } },
    fits: { where: { userId }, select: { fitScore: true, keywordScore: true, topMatches: true, updatedAt: true } },
    // v5: this user's evaluation (tier / score / reasons) from their own preferences
    evals: { where: { userId }, select: { tier: true, score: true, eligible: true, reasons: true, components: true, prefsVersion: true } },
  }) satisfies Prisma.JobInclude

type Row = Prisma.JobGetPayload<{ include: ReturnType<typeof jobInclude> }>

function toApi(j: Row, profileSkills: string[], semanticHit?: { score: number } | null, tierLabels?: Record<string, string>): Job {
  const { userStates, applications, atsReports, resumeVersions, fits, evals, ...row } = j
  const fit = fits[0]
  const ev = (evals as Array<{ tier: string; score: number; eligible: boolean; reasons: unknown; components: unknown }> | undefined)?.[0]
  const state = (userStates[0]?.state as Job['userState']) ?? null
  const app = applications[0]
  const report = atsReports[0]
  const s = serializeJob(row, state, app ? { application: { id: app.id, status: app.status, appliedAt: app.appliedAt?.toISOString() ?? null, followUpAt: app.followUpAt?.toISOString() ?? null, coverNote: app.coverNote, resumeVersionId: app.resumeVersionId, headlineUsed: app.headlineUsed, aboutUsed: app.aboutUsed, submittedVia: app.submittedVia, events: (app.events as Array<{ at: string; type: string; note: string | null }>) ?? [] } } : {})
  const qm = profileSkills.length ? quickMatchDetail(profileSkills, j.title, j.description, s.skills) : null
  return {
    ...s,
    ...(ev ? { eval: { tier: ev.tier, tierLabel: tierLabels?.[ev.tier] ?? (ev.tier === 'none' ? 'Other' : ev.tier), score: ev.score, eligible: ev.eligible, reasons: (ev.reasons as string[]) ?? [], components: ev.components as Record<string, number> }, rankingScore: Math.min(100, Math.max(0, Math.round(ev.score + (s.rankingScore - (row.baseScore ?? 0))))) } : {}),
    matchScore: qm?.score ?? null,
    matchWhy: qm ? { matched: qm.matched, missing: qm.missing } : null,
    fitScore: fit?.fitScore ?? null,
    fitWhy: fit ? ((fit.topMatches as Array<{ chunkKey: string; text: string; similarity: number }> | null) ?? []).slice(0, 2).map((m) => m.text.slice(0, 120)) : null,
    searchHit: semanticHit ? { semantic: Math.round(semanticHit.score * 100) } : null,
    progress: { analysed: Boolean(report), reportScore: report?.score ?? null, reportId: report?.id ?? null, pendingSuggestions: report?._count.suggestions ?? 0, tailored: resumeVersions.length > 0, tailoredVersionId: resumeVersions[0]?.id ?? null, applied: state === 'applied' },
  }
}

export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch (err) { return authErrorResponse(err)! }
  const { searchParams } = new URL(req.url)

  const tab = searchParams.get('tab') ?? 'browse'
  const cls = searchParams.get('class')
  const sort = searchParams.get('sort') ?? 'newest'
  const includeClosed = searchParams.get('includeClosed') === 'true'
  const employmentType = searchParams.get('employmentType')
  const company = searchParams.get('company')
  const remoteType = searchParams.get('remoteType')
  const region = searchParams.get('region')
  const eligibility = searchParams.get('eligibility')
  const category = searchParams.get('category')
  const salaryMin = searchParams.get('salaryMin')
  const experienceMax = searchParams.get('experienceMax')
  const sourceType = searchParams.get('sourceType')
  const since = searchParams.get('since') // ISO: "new since last visit"
  const q = searchParams.get('q')?.trim()
  const rawPage = parseInt(searchParams.get('page') ?? '1', 10)
  const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50
  const skip = (page - 1) * limit

  const where: Prisma.JobWhereInput = {}

  // v5 dynamic preferences: the inbox is this user's evaluations (tiers from THEIR document). Falls back to the
  // legacy owner-centric classes when the engine is off, the user has no document yet, or nothing has been
  // evaluated for them yet (first run — the re-evaluation task is in flight).
  let prefs: Preferences | null = null
  let evalsPending = false
  let useEvals = false
  if (ENGINE() === 'evals') {
    const { preferences } = services()
    const saved = await preferences.get(user.id).catch(() => null)
    if (saved) {
      prefs = saved.doc
      const n = await prisma.jobUserEval.count({ where: { userId: user.id } })
      useEvals = n > 0
      evalsPending = n === 0
    }
  }
  const tierLabels = prefs ? Object.fromEntries(prefs.tiers.map((t) => [t.id, t.label])) : undefined
  const tierFor = (c: string | null): string[] | null => {
    if (!prefs) return null
    if (!c || c === 'eligible') return prefs.feed.defaultTiers
    const t = LEGACY_CLASS_TO_TIER[c] ?? c
    return t === 'none' ? ['none'] : prefs.tiers.some((x) => x.id === t) ? [t] : prefs.feed.defaultTiers
  }

  // v3 (C2): user state lives in job_user_states; jobs.status is lifecycle only (new | closed)
  if (tab === 'saved') where.userStates = { some: { userId: user.id, state: 'saved' } }
  else if (tab === 'applied') where.userStates = { some: { userId: user.id, state: 'applied' } }
  else if (tab === 'rejected') where.userStates = { some: { userId: user.id, state: 'rejected' } }
  else if (tab === 'closed') where.status = 'closed'
  else {
    where.status = 'new'
    where.userStates = { none: { userId: user.id, state: { in: ['rejected', 'applied'] } } }
    if (!includeClosed) where.closedAt = null
    if (useEvals && prefs) {
      where.evals = { some: { userId: user.id, tier: { in: tierFor(cls)! } } }
      if (prefs.feed.hideEmploymentTypes.length) where.employmentType = { notIn: prefs.feed.hideEmploymentTypes as never }
    } else {
      // Browse defaults to eligible classes only; "Other" is opt-in
      if (!cls) where.opportunityClass = { in: [...ELIGIBLE] }
      where.employmentType = { notIn: ['internship', 'part_time'] }
    }
  }

  if (!(useEvals && tab === 'browse')) {
    if (cls === 'eligible') where.opportunityClass = { in: [...ELIGIBLE] }
    else if (cls && (CLASSES as readonly string[]).includes(cls)) where.opportunityClass = cls as (typeof CLASSES)[number]
  } else if (cls && tab !== 'browse') {
    where.evals = { some: { userId: user.id, tier: { in: tierFor(cls)! } } }
  }

  if (employmentType) where.employmentType = employmentType as Prisma.JobWhereInput['employmentType']
  if (company) where.OR = [{ companyId: company }, { company: { contains: company, mode: 'insensitive' } }]
  if (remoteType) where.remoteType = remoteType
  if (region) where.region = { contains: region, mode: 'insensitive' }
  if (eligibility) where.eligibility = eligibility
  if (category) where.category = { contains: category, mode: 'insensitive' }
  if (sourceType) where.sourceType = sourceType
  if (since) { const d = new Date(since); if (!Number.isNaN(d.getTime())) where.firstSeenAt = { gte: d } }
  if (salaryMin) {
    const v = parseFloat(salaryMin)
    if (!Number.isNaN(v)) where.salaryInrMin = { gte: v }
  }
  if (experienceMax) {
    // Audit NEW-11 (old F9): "at most N years required". experience_min is populated from job_requirements.yearsMin
    // at analysis time; unknown (null) must not exclude the row.
    const v = parseFloat(experienceMax)
    if (!Number.isNaN(v)) where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: [{ experienceMin: null }, { experienceMin: { lte: v } }] }]
  }
  // Search (audit NEW-09): lexical candidates come from Postgres FTS + trigram (indexed); semantic candidates
  // from the vector index when available; the two are fused by reciprocal rank. If the FTS migration is not
  // applied yet, the pre-v4 ILIKE path (synonym-expanded) is used.
  const expanded = q ? expandQuery(q) : null
  const lexical = q && expanded ? await lexicalCandidates(q, expanded.terms) : null
  if (q && expanded && lexical === null) {
    const qWhere: Prisma.JobWhereInput = {
      OR: expanded.terms.flatMap((term) => [
        { title: { contains: term, mode: 'insensitive' as const } },
        { company: { contains: term, mode: 'insensitive' as const } },
        { skills: { contains: term, mode: 'insensitive' as const } },
        { description: { contains: term, mode: 'insensitive' as const } },
      ]),
    }
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), qWhere]
  }

  const orderBy: Prisma.JobOrderByWithRelationInput[] =
    sort === 'score'
      ? [{ baseScore: 'desc' }, { firstSeenAt: 'desc' }]
      : [{ opportunityClass: 'asc' }, { firstSeenAt: 'desc' }]

  try {
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: user.id }, select: { skills: true } })
    const profileSkills = ((profile?.skills as Array<{ canonical?: string; name?: string }> | null) ?? []).map((x) => x.canonical ?? x.name ?? '').filter(Boolean)
    const include = jobInclude(user.id)

    if (q && lexical !== null) {
      const semantic = (await semanticCandidates(q, 150)) ?? []
      const ids = fuse([lexical.map((h) => h.jobId), semantic.map((h) => h.jobId)])
      if (!ids.length) return NextResponse.json({ data: [], total: 0, page, limit, hybrid: semantic.length > 0, fts: true, expandedTerms: expanded?.added ?? [] })
      const rows = await prisma.job.findMany({ where: { ...where, id: { in: ids } }, include })
      const byId = new Map(rows.map((r) => [r.id, r]))
      const semById = new Map(semantic.map((h) => [h.jobId, h]))
      const ordered = ids.map((id) => byId.get(id)).filter((r): r is Row => Boolean(r)).map((r) => toApi(r, profileSkills, semById.get(r.id) ?? null, tierLabels))
      return NextResponse.json({ data: ordered.slice(skip, skip + limit), total: ordered.length, page, limit, hybrid: semantic.length > 0, fts: true, expandedTerms: expanded?.added ?? [] })
    }
    // Pre-v4 fallback (FTS migration not applied): exact ILIKE ∪ semantic, fused.
    if (q) {
      const semantic = await semanticCandidates(q, 150)
      if (semantic && semantic.length) {
        const baseWhere: Prisma.JobWhereInput = { ...where, AND: (Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []).filter((c) => !(c as { OR?: unknown }).OR) }
        const exact = await prisma.job.findMany({ where, orderBy: [{ firstSeenAt: 'desc' }], take: 200, select: { id: true } })
        const ids = fuse([exact.map((j) => j.id), semantic.map((h) => h.jobId)])
        const rows = await prisma.job.findMany({ where: { ...baseWhere, id: { in: ids } }, include })
        const byId = new Map(rows.map((r) => [r.id, r]))
        const semById = new Map(semantic.map((h) => [h.jobId, h]))
        const ordered = ids.map((id) => byId.get(id)).filter((r): r is Row => Boolean(r)).map((r) => toApi(r, profileSkills, semById.get(r.id) ?? null, tierLabels))
        return NextResponse.json({ data: ordered.slice(skip, skip + limit), total: ordered.length, page, limit, hybrid: true, fts: false, expandedTerms: expanded?.added ?? [] })
      }
    }

    if (sort === 'match' && profileSkills.length) {
      // Prefer stored semantic fits (fit-v1) when the user has any; they are DB-sortable and cover the whole feed.
      const fitCount = await prisma.jobFit.count({ where: { userId: user.id, job: where } })
      if (fitCount > 0) {
        const [fitRows, total] = await Promise.all([
          prisma.jobFit.findMany({ where: { userId: user.id, job: where }, orderBy: [{ fitScore: 'desc' }, { updatedAt: 'desc' }], skip, take: limit, include: { job: { include } } }),
          prisma.job.count({ where }),
        ])
        return NextResponse.json({ data: fitRows.map((f) => toApi(f.job as Row, profileSkills, null, tierLabels)), total: fitCount, page, limit, unscored: Math.max(0, total - fitCount), engine: useEvals ? 'evals' : 'legacy' })
      }
      // In-memory ranking over a bounded recent window; deterministic and cheap for a few hundred rows.
      const [window, total] = await Promise.all([
        prisma.job.findMany({ where, orderBy: [{ firstSeenAt: 'desc' }], take: MATCH_SORT_WINDOW, include }),
        prisma.job.count({ where }),
      ])
      const ranked = window.map((j) => toApi(j, profileSkills, null, tierLabels)).sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1) || b.firstSeenAt.localeCompare(a.firstSeenAt))
      return NextResponse.json({ data: ranked.slice(skip, skip + limit), total: Math.min(total, ranked.length), page, limit, windowed: total > ranked.length })
    }

    if (sort === 'score' && useEvals) {
      const [rows, total] = await Promise.all([
        prisma.jobUserEval.findMany({ where: { userId: user.id, job: where }, orderBy: [{ score: 'desc' }, { evaluatedAt: 'desc' }], skip, take: limit, include: { job: { include } } }),
        prisma.job.count({ where }),
      ])
      return NextResponse.json({ data: rows.map((r) => toApi(r.job as Row, profileSkills, null, tierLabels)), total, page, limit, engine: 'evals', tiers: prefs?.tiers.map((t) => ({ id: t.id, label: t.label, enabled: t.enabled })) })
    }
    const [jobs, total] = await Promise.all([prisma.job.findMany({ where, orderBy, skip, take: limit, include }), prisma.job.count({ where })])
    return NextResponse.json({ data: jobs.map((j) => toApi(j, profileSkills, null, tierLabels)), total, page, limit, ...(expanded ? { expandedTerms: expanded.added, hybrid: false } : {}), engine: useEvals ? 'evals' : 'legacy', evalsPending, tiers: prefs?.tiers.map((t) => ({ id: t.id, label: t.label, enabled: t.enabled })) })
  } catch (err) {
    log.error('GET /api/jobs failed', err as Error)
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }
}
