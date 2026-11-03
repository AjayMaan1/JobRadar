import type { PrismaClient } from '@jobradar/db'
import { WATCHLIST_CONFIG } from './config.js'

/** Minimal object-store shape needed for artifact cleanup (avoids a hard dependency on @jobradar/storage here). */
export interface ArtifactStore { delete(key: string): Promise<void> }

/**
 * Vector/file lifecycle hooks (implemented by @jobradar/resume ErasureService; injected so this package does not
 * depend on it). Audit NEW-01/NEW-08: `embeddings` has no FK and must be cleaned explicitly.
 */
export interface LifecycleHooks {
  eraseResumeVersions(ids: string[]): Promise<{ embeddings: number; files: number }>
  eraseJobs(jobIds: string[]): Promise<number>
  pruneClosedJobVectors(days: number): Promise<number>
  sweepOrphanVectors(): Promise<number>
  sweepOrphanFiles(opts?: { graceMinutes?: number }): Promise<{ scanned: number; deleted: number }>
}

export interface RetentionReport { fetchRuns: number; sightings: number; jobs: number; circuitsReset: number; reports: number; tailoredVersions: number; sessions: number; vectors: number; authTokens: number; orphanFiles: number }

export class RetentionService {
  constructor(private prisma: PrismaClient, private store?: ArtifactStore | null, private hooks?: LifecycleHooks | null) {}

  async run(): Promise<RetentionReport> {
    const fr = await this.prisma.fetchRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - WATCHLIST_CONFIG.fetchRunRetentionDays * 86400_000) } } })
    // Sightings: only rows that have been gone for the retention window. Live sightings are never pruned.
    const js = await this.prisma.jobSighting.deleteMany({ where: { goneAt: { lt: new Date(Date.now() - WATCHLIST_CONFIG.sightingRetentionDays * 86400_000) } } })
    let jobs = 0
    let vectors = 0
    if (WATCHLIST_CONFIG.pruneClosedJobs) {
      // never prune a job a user has touched (application, saved/rejected state, tailored version, match report)
      const where = { status: 'closed', closedAt: { lt: new Date(Date.now() - 365 * 86400_000) }, applications: { none: {} }, notifications: { none: {} }, userStates: { none: {} }, resumeVersions: { none: {} }, atsReports: { none: {} } }
      const ids = (await this.prisma.job.findMany({ where, select: { id: true }, take: 5000 })).map((j) => j.id)
      if (ids.length) {
        vectors += (await this.hooks?.eraseJobs(ids)) ?? 0
        const r = await this.prisma.job.deleteMany({ where: { id: { in: ids } } })
        jobs = r.count
      }
    }
    // Closed jobs keep their row but lose their vectors after the retention window; plus an orphan sweep.
    let orphanFiles = 0
    if (this.hooks) {
      vectors += await this.hooks.pruneClosedJobVectors(WATCHLIST_CONFIG.closedJobVectorRetentionDays)
      vectors += await this.hooks.sweepOrphanVectors()
      orphanFiles = (await this.hooks.sweepOrphanFiles({ graceMinutes: 120 })).deleted
    }
    // 7-day counters
    const weekAgo = new Date(Date.now() - 7 * 86400_000)
    await this.prisma.companyBoard.updateMany({ where: { blockedCount7d: { gt: 0 }, updatedAt: { lt: weekAgo } }, data: { blockedCount7d: 0 } })
    const circuits = await this.prisma.hostPolicy.updateMany({
      where: { circuitState: { not: 'closed' }, circuitOpenUntil: { lt: new Date() } },
      data: { circuitState: 'closed', circuitOpenUntil: null },
    })
    await this.prisma.hostPolicy.updateMany({ where: { tripCount7d: { gt: 0 }, circuitOpenedAt: { lt: weekAgo } }, data: { tripCount7d: 0 } })

    // v3 derived artifacts (backlog C11-4): match reports and tailored versions that were never used in an
    // application age out; master/correction versions and anything referenced by an application are kept.
    const reportCutoff = new Date(Date.now() - WATCHLIST_CONFIG.reportRetentionDays * 86400_000)
    const reports = await this.prisma.atsReport.deleteMany({ where: { createdAt: { lt: reportCutoff }, resumeVersion: { applications: { none: {} }, kind: { not: 'tailored' } } } })
    const versionCutoff = new Date(Date.now() - WATCHLIST_CONFIG.tailoredVersionRetentionDays * 86400_000)
    const stale = await this.prisma.resumeVersion.findMany({ where: { kind: 'tailored', createdAt: { lt: versionCutoff }, applications: { none: {} }, children: { none: {} } }, select: { id: true, pdfKey: true, docxKey: true } })
    if (stale.length) {
      if (this.hooks) vectors += (await this.hooks.eraseResumeVersions(stale.map((v) => v.id))).embeddings
      else for (const v of stale) for (const key of [v.pdfKey, v.docxKey]) if (key) await this.store?.delete(key).catch(() => undefined)
    }
    const tv = stale.length ? await this.prisma.resumeVersion.deleteMany({ where: { id: { in: stale.map((v) => v.id) } } }) : { count: 0 }
    const sessions = await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    const authTokens = await this.prisma.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] } })
    return { fetchRuns: fr.count, sightings: js.count, jobs, circuitsReset: circuits.count, reports: reports.count, tailoredVersions: tv.count, sessions: sessions.count, vectors, authTokens: authTokens.count, orphanFiles }
  }
}
