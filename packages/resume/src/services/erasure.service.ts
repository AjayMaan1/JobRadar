import type { PrismaClient } from '@jobradar/db'
import type { ObjectStore } from '@jobradar/storage'
import { log } from '@jobradar/log'

/**
 * Data-lifecycle hooks (audit NEW-01 / NEW-08 / NEW-22). `embeddings` is polymorphic (owner_type + owner_id,
 * no FK) and stores the embedded *text* next to each vector, so Prisma cascades never reach it. Every path that
 * removes an owner must go through here:
 *
 *   DELETE /api/me                → eraseUser
 *   DELETE /api/resumes/:id       → eraseResume
 *   retention (tailored versions) → eraseResumeVersions
 *   retention / liveness (jobs)   → eraseJobs / pruneClosedJobVectors
 *
 * Order is always: vectors → files → rows, so a crash in the middle leaves nothing that a second run can't
 * finish, and never a row that still references a deleted file.
 */
export interface ErasureReport {
  embeddings: number
  files: number
  rows: Record<string, number>
}

export class ErasureService {
  constructor(private prisma: PrismaClient, private store: Pick<ObjectStore, 'delete' | 'deletePrefix' | 'list'> | null = null) {}

  /** Delete vectors for one owner type. */
  async embeddingsFor(ownerType: 'job' | 'requirement' | 'resume_version' | 'profile', ownerIds: string[]): Promise<number> {
    if (!ownerIds.length) return 0
    let n = 0
    for (let i = 0; i < ownerIds.length; i += 500) {
      const r = await this.prisma.embedding.deleteMany({ where: { ownerType, ownerId: { in: ownerIds.slice(i, i + 500) } } })
      n += r.count
    }
    return n
  }

  /** Vectors + rendered files for resume versions (rows are deleted by the caller or by cascade). */
  async eraseResumeVersions(versionIds: string[]): Promise<{ embeddings: number; files: number }> {
    if (!versionIds.length) return { embeddings: 0, files: 0 }
    const embeddings = await this.embeddingsFor('resume_version', versionIds)
    let files = 0
    if (this.store) {
      const versions = await this.prisma.resumeVersion.findMany({ where: { id: { in: versionIds } }, select: { pdfKey: true, docxKey: true } })
      for (const v of versions) for (const k of [v.pdfKey, v.docxKey]) if (k) { await this.store.delete(k).catch(() => undefined); files++ }
    }
    return { embeddings, files }
  }

  /** One resume: its versions' vectors, its object-store prefix, then the row (versions/reports/suggestions cascade). */
  async eraseResume(resumeId: string, userId: string): Promise<ErasureReport | null> {
    const resume = await this.prisma.resume.findFirst({ where: { id: resumeId, userId }, select: { id: true } })
    if (!resume) return null
    const versions = await this.prisma.resumeVersion.findMany({ where: { resumeId }, select: { id: true } })
    const embeddings = await this.embeddingsFor('resume_version', versions.map((v) => v.id))
    const files = this.store ? await this.store.deletePrefix(`users/${userId}/resumes/${resumeId}`) : 0
    await this.prisma.resume.delete({ where: { id: resumeId } })
    log.info('erasure: resume removed', { userId, resumeId, embeddings, files, versions: versions.length })
    return { embeddings, files, rows: { resumes: 1, resumeVersions: versions.length } }
  }

  /** Full account erasure (C11-1): vectors (profile + every version) → files → user row (everything else cascades). */
  async eraseUser(userId: string): Promise<ErasureReport> {
    const versions = await this.prisma.resumeVersion.findMany({ where: { resume: { userId } }, select: { id: true } })
    const embeddings = (await this.embeddingsFor('resume_version', versions.map((v) => v.id))) + (await this.embeddingsFor('profile', [userId]))
    const files = this.store ? await this.store.deletePrefix(`users/${userId}`) : 0
    // job_fits, job_user_states, applications, sessions, profile, resumes → versions → reports → suggestions cascade from users.
    await this.prisma.user.delete({ where: { id: userId } })
    log.info('erasure: user removed', { userId, embeddings, files, versions: versions.length })
    return { embeddings, files, rows: { users: 1, resumeVersions: versions.length } }
  }

  /** Jobs removed by retention: their vectors and requirement vectors (job_fits cascade with the row). */
  async eraseJobs(jobIds: string[]): Promise<number> {
    return (await this.embeddingsFor('job', jobIds)) + (await this.embeddingsFor('requirement', jobIds))
  }

  /**
   * Closed jobs keep their row (history) but lose their vectors after `days` (NEW-08): nothing searches or
   * ranks a closed posting, and the text column would otherwise grow forever.
   */
  async pruneClosedJobVectors(days = 30, batch = 2000): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86400_000)
    const candidates = await this.prisma.embedding.findMany({ where: { ownerType: { in: ['job', 'requirement'] } }, select: { ownerId: true }, distinct: ['ownerId'], take: batch })
    if (!candidates.length) return 0
    const ids = candidates.map((c) => c.ownerId)
    const closed = await this.prisma.job.findMany({ where: { id: { in: ids }, closedAt: { lt: cutoff } }, select: { id: true } })
    const existing = new Set((await this.prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((j) => j.id))
    const orphans = ids.filter((id) => !existing.has(id)) // job row already gone (pruned without hooks, or manual SQL)
    return this.eraseJobs([...closed.map((j) => j.id), ...orphans])
  }

  /**
   * Weekly consistency sweep: vectors whose owner no longer exists (any type). Cheap insurance against paths
   * that bypass the hooks (manual SQL, crashes between steps).
   */
  async sweepOrphanVectors(batch = 5000): Promise<number> {
    let removed = 0
    for (const ownerType of ['resume_version', 'profile', 'job', 'requirement'] as const) {
      const rows = await this.prisma.embedding.findMany({ where: { ownerType }, select: { ownerId: true }, distinct: ['ownerId'], take: batch })
      if (!rows.length) continue
      const ids = rows.map((r) => r.ownerId)
      const alive = new Set<string>(
        ownerType === 'resume_version'
          ? (await this.prisma.resumeVersion.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((x) => x.id)
          : ownerType === 'profile'
            ? (await this.prisma.candidateProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true } })).map((x) => x.userId)
            : (await this.prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((x) => x.id),
      )
      removed += await this.embeddingsFor(ownerType, ids.filter((id) => !alive.has(id)))
    }
    if (removed) log.warn('erasure: orphan vectors removed', { removed })
    return removed
  }

  /**
   * Orphan files (audit NEW-22): objects under users/ that no row references (crash between put and the DB
   * write, or a row deleted outside the hooks). Files younger than `graceMinutes` are skipped so an upload in
   * flight is never removed. Returns deleted count.
   */
  async sweepOrphanFiles(opts: { graceMinutes?: number; dryRun?: boolean; limit?: number } = {}): Promise<{ scanned: number; deleted: number }> {
    if (!this.store?.list) return { scanned: 0, deleted: 0 }
    const keys = await this.store.list('users/', opts.limit ?? 20_000)
    if (!keys.length) return { scanned: 0, deleted: 0 }
    const referenced = new Set<string>()
    for (const r of await this.prisma.resume.findMany({ where: { sourceFileKey: { not: null } }, select: { sourceFileKey: true } })) referenced.add(r.sourceFileKey!)
    for (const v of await this.prisma.resumeVersion.findMany({ where: { OR: [{ pdfKey: { not: null } }, { docxKey: { not: null } }] }, select: { pdfKey: true, docxKey: true } })) { if (v.pdfKey) referenced.add(v.pdfKey); if (v.docxKey) referenced.add(v.docxKey) }
    // Files belonging to an existing user but not referenced are orphans, except very recent ones.
    const userIds = new Set((await this.prisma.user.findMany({ select: { id: true } })).map((u) => u.id))
    const cutoff = Date.now() - (opts.graceMinutes ?? 60) * 60_000
    let deleted = 0
    for (const key of keys) {
      if (referenced.has(key)) continue
      const userId = key.split('/')[1]
      // key layout users/<userId>/...; a user that no longer exists → whole prefix is orphaned too
      if (userId && userIds.has(userId) && /\/original\.(pdf|docx)$/.test(key)) {
        // could be an in-flight upload: only delete if older than the grace window (local driver exposes mtime via head())
        const meta = await (this.store as { head?: (k: string) => Promise<{ size: number } | null> }).head?.(key).catch(() => null)
        if (meta === null) continue
        if (await this.youngerThan(key, cutoff)) continue
      }
      if (!opts.dryRun) await this.store.delete(key).catch(() => undefined)
      deleted++
    }
    if (deleted) log.warn('erasure: orphan files removed', { scanned: keys.length, deleted, dryRun: Boolean(opts.dryRun) })
    return { scanned: keys.length, deleted }
  }

  private async youngerThan(key: string, cutoffMs: number): Promise<boolean> {
    // Only the local driver can tell us the mtime cheaply; for S3 we rely on the DB write happening within seconds.
    const st = await (this.store as { mtime?: (k: string) => Promise<number | null> }).mtime?.(key).catch(() => null)
    return st !== null && st !== undefined && st > cutoffMs
  }
}
