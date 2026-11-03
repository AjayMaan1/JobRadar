import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { requireAdmin, authErrorResponse, currentUser } from '../../../lib/auth'
import { LlmBudget, describeLlm, type LlmStatus } from '@jobradar/llm'
import { log, withTimeout } from '@jobradar/log'
import { OpsAlerter } from '@jobradar/notifications'
import { services } from '../../../lib/services'

/** Worker liveness (audit NEW-05): the worker writes `worker:heartbeat` every 30 s; stale > 3 min = down. */
export const HEARTBEAT_STALE_MS = parseInt(process.env.WORKER_HEARTBEAT_STALE_MS ?? '180000', 10)

function healthTokenOk(req: NextRequest): boolean {
  const expected = process.env.HEALTH_TOKEN
  const given = req.headers.get('x-health-token')
  if (!expected || !given) return false
  const a = Buffer.from(expected), b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

let opsAlerter: OpsAlerter | null = null

export async function GET(req: NextRequest) {
  // Monitors: shared token (timing-safe) — audit NEW-10. Everyone else: admin session.
  if (!healthTokenOk(req)) { try { await requireAdmin() } catch (err) { return authErrorResponse(err)! } }
  try {
    const now = Date.now()
    const d1 = new Date(now - 86400_000)
    const m15 = new Date(now - 15 * 60_000)
    const d7 = new Date(now - 7 * 86400_000)

    const [companies, watched, hot, boards, activeBoards, blockedBoards, failingBoards, pendingDiscoveries, openJobs, jobs24h, p1, p2, p3] = await Promise.all([
      prisma.company.count(),
      prisma.company.count({ where: { status: 'watched' } }),
      prisma.company.count({ where: { OR: [{ tier: 'hot' }, { manualTier: 'hot' }], status: 'watched' } }),
      prisma.companyBoard.count(),
      prisma.companyBoard.count({ where: { enabled: true, status: 'active' } }),
      prisma.companyBoard.count({ where: { status: 'blocked' } }),
      prisma.companyBoard.count({ where: { status: 'failing' } }),
      prisma.companyDiscovery.count({ where: { resolution: 'pending' } }),
      prisma.job.count({ where: { closedAt: null, status: 'new', opportunityClass: { in: ['p1_global_remote', 'p2_india_remote', 'p3_ncr_hybrid'] } } }),
      prisma.job.count({ where: { firstSeenAt: { gte: d1 } } }),
      prisma.job.count({ where: { firstSeenAt: { gte: d1 }, opportunityClass: 'p1_global_remote', employmentType: { notIn: ['internship', 'part_time'] } } }),
      prisma.job.count({ where: { firstSeenAt: { gte: d1 }, opportunityClass: 'p2_india_remote', employmentType: { notIn: ['internship', 'part_time'] } } }),
      prisma.job.count({ where: { firstSeenAt: { gte: d1 }, opportunityClass: 'p3_ncr_hybrid', employmentType: { notIn: ['internship', 'part_time'] } } }),
    ])

    const runs = await prisma.fetchRun.groupBy({ by: ['host', 'outcome'], where: { startedAt: { gte: m15 } }, _count: { _all: true } })
    const byHost: Record<string, Record<string, number>> = {}
    for (const r of runs) { byHost[r.host] ??= {}; byHost[r.host][r.outcome] = r._count._all }
    const hosts = Object.entries(byHost).map(([host, o]) => {
      const total = Object.values(o).reduce((a, b) => a + b, 0)
      return { host, total, rateLimited: o.rate_limited ?? 0, blocked: o.blocked ?? 0, errors: o.error ?? 0, timeouts: o.timeout ?? 0, unchanged: o.unchanged ?? 0, changed: o.changed ?? 0, rateLimitedPct: total ? ((o.rate_limited ?? 0) / total) * 100 : 0 }
    }).sort((a, b) => b.total - a.total)

    const sightings = await prisma.jobSighting.findMany({ where: { firstSeenAt: { gte: d7 }, postedAtSrc: { not: null }, boardId: { not: null } }, select: { firstSeenAt: true, postedAtSrc: true }, take: 5000 })
    const deltas = sightings.map((s) => (s.firstSeenAt.getTime() - s.postedAtSrc!.getTime()) / 60_000).filter((d) => d >= 0 && d < 43200).sort((a, b) => a - b)
    const timeToDetect = { medianMinutes: deltas.length ? deltas[Math.floor(deltas.length / 2)] : null, samples: deltas.length }

    const policies = await prisma.hostPolicy.findMany({ orderBy: { host: 'asc' }, select: { id: true, host: true, enabled: true, circuitState: true, circuitOpenUntil: true, tripCount7d: true, dailyBudget: true, minIntervalMs: true } })
    const problem = await prisma.companyBoard.findMany({ where: { status: { in: ['blocked', 'failing', 'gone'] } }, include: { company: { select: { name: true } } }, take: 50, orderBy: { updatedAt: 'desc' } })
    const anchorsWithoutEligible = await prisma.company.findMany({ where: { anchor: true, bestClass: 'none', lastProbedAt: { not: null } }, select: { id: true, name: true, bestClass: true, lastProbedAt: true } })

    const alerts: string[] = []
    for (const h of hosts) {
      if (h.blocked > 0) alerts.push(`BLOCKED responses from ${h.host}: ${h.blocked} in 15m`)
      if (h.total >= 20 && h.rateLimitedPct > 1) alerts.push(`429 rate ${h.rateLimitedPct.toFixed(1)}% on ${h.host}`)
    }
    for (const p of policies) if (p.circuitState === 'open' && p.circuitOpenUntil && p.circuitOpenUntil.getTime() > now) alerts.push(`circuit open: ${p.host}`)
    if (blockedBoards) alerts.push(`${blockedBoards} blocked board(s) need review`)

    // v3 tiles (C11-4): user-task queues and LLM spend today. Best-effort — Redis may be down.
    let v3: { queues: Record<string, { waiting: number; active: number; failed: number }>; llm: { calls: number; usd: number; byPurpose: Record<string, number> } | null; resumes: number; reportsToday: number; ollama?: { reachable: boolean; models: string[] }; ai?: LlmStatus; embeddings?: { jobs: number; fits: number } } | null = null
    let worker: { mode: 'bullmq' | 'inline'; alive: boolean | null; lastHeartbeatAt: string | null; staleSec: number | null; version: string | null } = { mode: 'inline', alive: null, lastHeartbeatAt: null, staleSec: null, version: null }
    try {
      const { bullQueues, redis, inline, mode } = services()
      const pick = (c: Record<string, number>) => ({ waiting: c.waiting ?? 0, active: c.active ?? 0, failed: c.failed ?? 0 })
      const empty = { waiting: 0, active: 0, failed: 0 }
      const [rp, jd, sc, sg, rr] = bullQueues
        ? (await withTimeout(Promise.all(bullQueues.slice(0, 5).map((q) => q.getJobCounts('waiting', 'active', 'failed'))), 2500, 'queue counts')).map(pick)
        : [{ ...empty, waiting: inline?.pending.count ?? 0 }, empty, empty, empty, empty]
      const llm = bullQueues ? await new LlmBudget(redis).today().catch(() => null) : null
      // Worker heartbeat (NEW-05). In inline mode the web process is the worker.
      worker.mode = mode
      if (mode === 'bullmq') {
        const raw = await withTimeout(redis.get('worker:heartbeat'), 1500, 'heartbeat').catch(() => null)
        const hb = raw ? (JSON.parse(raw) as { at: string; version?: string }) : null
        const staleMs = hb ? now - new Date(hb.at).getTime() : null
        worker = { mode, alive: hb ? staleMs! < HEARTBEAT_STALE_MS : false, lastHeartbeatAt: hb?.at ?? null, staleSec: staleMs === null ? null : Math.round(staleMs / 1000), version: hb?.version ?? null }
        if (!worker.alive) {
          alerts.push(hb ? `WORKER DOWN — last heartbeat ${worker.staleSec}s ago` : 'WORKER DOWN — no heartbeat recorded')
          opsAlerter ??= new OpsAlerter(redis, parseInt(process.env.OPS_ALERT_EVERY_SEC ?? '3600', 10))
          void opsAlerter.alert('worker-down', hb ? `Worker heartbeat stale (${worker.staleSec}s). Crawl, alerts, parsing and rendering are stopped.` : 'No worker heartbeat. Is apps/worker running?')
        }
      } else worker.alive = true
      const [resumes, reportsToday] = await Promise.all([prisma.resume.count(), prisma.atsReport.count({ where: { createdAt: { gte: d1 } } })])
      v3 = { queues: { 'resume-parse': rp, 'jd-analyze': jd, 'ats-score': sc, suggest: sg, 'resume-render': rr }, llm, resumes, reportsToday }
      // AI (docs/AI-PROVIDERS.md §5): every configured provider — local Ollama and/or hosted free tiers — with
      // reachability, data-use class and client-side quota. `ollama` is kept for older dashboards.
      try {
        const ai = await withTimeout(describeLlm(), 6000, 'llm status')
        v3.ai = ai
        const ollama = ai.providers.find((p) => p.name === 'ollama')
        if (ollama) v3.ollama = { reachable: ollama.reachable === true, models: [] }
        for (const p of ai.providers) {
          if (p.reachable === false) alerts.push(`AI provider ${p.name} ${p.detail ?? 'not reachable'}${ai.providers.length > 1 ? ' — the chain falls back to the next provider' : ' — AI features unavailable'}`)
          else if (p.detail && /quota/.test(p.detail)) alerts.push(`AI provider ${p.name}: ${p.detail}`)
        }
        if (!ai.providers.length) v3.ai = { ...ai, providers: [] }
      } catch (err) { alerts.push(`AI status unavailable: ${(err as Error).message}`) }
      const [embJobs, fits] = await Promise.all([prisma.embedding.count({ where: { ownerType: 'job', chunkKey: 'head' } }), prisma.jobFit.count()])
      v3.embeddings = { jobs: embJobs, fits }
      for (const [name, c] of Object.entries(v3.queues)) if (c.failed >= 5) alerts.push(`${c.failed} failed jobs on queue ${name}`)
    } catch (err) {
      log.warn('health: v3 tiles unavailable', { reason: (err as Error).message })
      alerts.push('Redis unreachable — queues, budgets and worker heartbeat unknown')
    }

    // v5: preferences engine — active users, crawl scope (union), suggestions, the caller's own 24h tier counts
    let prefsTile: { engine: string; activeUsers: number; evaluated: number; scope: unknown; suggestions: unknown[]; myTiers24h: Record<string, number> } | null = null
    try {
      const { evals: evalSvc, crawlScope } = services()
      const users = await evalSvc.activeUsers(true)
      const me = (await currentUser())?.id
      const mine = me ? await prisma.jobUserEval.groupBy({ by: ['tier'], where: { userId: me, job: { firstSeenAt: { gte: d1 } } }, _count: { _all: true } }) : []
      const [scope, suggestions, evaluated] = await Promise.all([crawlScope.scope(true), crawlScope.suggestions(), prisma.jobUserEval.count()])
      prefsTile = { engine: process.env.PREFS_ENGINE === 'legacy' ? 'legacy' : 'evals', activeUsers: users.length, evaluated, scope, suggestions, myTiers24h: Object.fromEntries(mine.map((m) => [m.tier, m._count._all])) }
      for (const sg of suggestions as Array<{ message: string }>) alerts.push(`crawl scope: ${sg.message}`)
    } catch (err) {
      log.warn('health: preferences tile unavailable', { reason: (err as Error).message })
    }

    return NextResponse.json({
      v3,
      worker,
      prefs: prefsTile,
      counts: { companies, watched, hot, boards, activeBoards, blockedBoards, failingBoards, pendingDiscoveries, openJobs, jobs24h, p1_24h: p1, p2_24h: p2, p3_24h: p3 },
      timeToDetect,
      hosts,
      policies,
      alerts,
      problemBoards: problem.map((b) => ({ id: b.id, company: b.company.name, atsType: b.atsType, slug: b.slug, status: b.status, lastError: b.lastError, consecutiveFailures: b.consecutiveFailures, lastSuccessAt: b.lastSuccessAt })),
      anchorsWithoutEligible,
    })
  } catch (err) {
    log.error('GET /api/health failed', err as Error)
    return NextResponse.json({ error: 'Failed to compute health' }, { status: 500 })
  }
}
