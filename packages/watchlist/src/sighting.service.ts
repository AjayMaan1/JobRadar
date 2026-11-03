import { createHash } from 'node:crypto'
import type { PrismaClient } from '@jobradar/db'
import { WATCHLIST_CONFIG } from './config.js'

export interface SightingInput {
  externalId: string
  hashFields?: Record<string, unknown> | null
  postedAt?: string | null
}

export interface ReconcileResult {
  newIds: string[]
  changedIds: string[]
  reappearedIds: string[]
  goneIds: string[]
  closedJobIds: string[]
  suspectDrop: boolean
  seen: number
}

export function payloadHash(fields: Record<string, unknown> | null | undefined): string {
  return createHash('sha1').update(JSON.stringify(fields ?? {})).digest('hex')
}

/**
 * The diff engine. "New" == no (feed_key, external_id) row existed. For full-list feeds (ATS boards),
 * absence across N successful polls marks a sighting gone; when every sighting of a job is gone, the
 * job is closed. Windowed feeds (aggregators) never produce gone events here.
 */
export class SightingService {
  constructor(private prisma: PrismaClient) {}

  async reconcile(opts: {
    feedKey: string
    boardId?: string | null
    sourceId?: string | null
    items: SightingInput[]
    fullList: boolean
    previousCount?: number
  }): Promise<ReconcileResult> {
    const now = new Date()
    const result: ReconcileResult = { newIds: [], changedIds: [], reappearedIds: [], goneIds: [], closedJobIds: [], suspectDrop: false, seen: opts.items.length }

    const existing = await this.prisma.jobSighting.findMany({ where: { feedKey: opts.feedKey } })
    const byExt = new Map(existing.map((s) => [s.externalId, s]))
    const presentIds = new Set<string>()

    for (const item of opts.items) {
      if (!item.externalId || presentIds.has(item.externalId)) continue
      presentIds.add(item.externalId)
      const hash = payloadHash(item.hashFields)
      const postedAt = item.postedAt ? new Date(item.postedAt) : null
      const row = byExt.get(item.externalId)
      if (!row) {
        try {
          const created = await this.prisma.jobSighting.create({
            data: {
              feedKey: opts.feedKey,
              boardId: opts.boardId ?? null,
              sourceId: opts.sourceId ?? null,
              externalId: item.externalId,
              payloadHash: hash,
              postedAtSrc: postedAt && !isNaN(postedAt.getTime()) ? postedAt : null,
              firstSeenAt: now,
              lastSeenAt: now,
            },
          })
          byExt.set(item.externalId, created as any)
          result.newIds.push(item.externalId)
        } catch {
          // Concurrent insert or existing record
        }
        continue
      }
      const data: Record<string, unknown> = { lastSeenAt: now, missingCount: 0 }
      if (row.goneAt) {
        data.goneAt = null
        result.reappearedIds.push(item.externalId)
      }
      if (row.payloadHash !== hash) {
        data.payloadHash = hash
        result.changedIds.push(item.externalId)
      }
      await this.prisma.jobSighting.update({ where: { id: row.id }, data })
    }

    if (!opts.fullList) return result

    // Closure guard: a sudden large drop is more likely a partial response than mass closure.
    const prev = opts.previousCount ?? existing.filter((s) => !s.goneAt).length
    if (prev >= 10 && opts.items.length < prev * (1 - WATCHLIST_CONFIG.suspectDropFraction)) {
      result.suspectDrop = true
      return result
    }

    const missing = existing.filter((s) => !presentIds.has(s.externalId) && !s.goneAt)
    for (const s of missing) {
      const count = s.missingCount + 1
      if (count >= WATCHLIST_CONFIG.goneAfterMissingPolls) {
        await this.prisma.jobSighting.update({ where: { id: s.id }, data: { missingCount: count, goneAt: now } })
        result.goneIds.push(s.externalId)
        if (s.jobId) {
          const closed = await this.maybeCloseJob(s.jobId, now)
          if (closed) result.closedJobIds.push(s.jobId)
        }
      } else {
        await this.prisma.jobSighting.update({ where: { id: s.id }, data: { missingCount: count } })
      }
    }
    // Reappeared sightings re-open their job
    if (result.reappearedIds.length) {
      const rows = await this.prisma.jobSighting.findMany({ where: { feedKey: opts.feedKey, externalId: { in: result.reappearedIds }, jobId: { not: null } }, select: { jobId: true } })
      const ids = [...new Set(rows.map((r) => r.jobId!))]
      if (ids.length) {
        await this.prisma.job.updateMany({ where: { id: { in: ids }, closedAt: { not: null } }, data: { closedAt: null } })
        await this.prisma.job.updateMany({ where: { id: { in: ids }, status: 'closed' }, data: { status: 'new' } })
      }
    }
    return result
  }

  /**
   * An UNCHANGED successful poll (304 / identical body) still confirms that every sighting already
   * flagged as missing is still absent — without this, a removed posting would stall at
   * missing_count = 1 because the stable list never triggers a full reconcile again.
   */
  async confirmMissing(feedKey: string): Promise<{ goneIds: string[]; closedJobIds: string[] }> {
    const now = new Date()
    const pending = await this.prisma.jobSighting.findMany({ where: { feedKey, goneAt: null, missingCount: { gt: 0 } } })
    const goneIds: string[] = []
    const closedJobIds: string[] = []
    for (const s of pending) {
      const count = s.missingCount + 1
      if (count >= WATCHLIST_CONFIG.goneAfterMissingPolls) {
        await this.prisma.jobSighting.update({ where: { id: s.id }, data: { missingCount: count, goneAt: now } })
        goneIds.push(s.externalId)
        if (s.jobId && (await this.maybeCloseJob(s.jobId, now))) closedJobIds.push(s.jobId)
      } else {
        await this.prisma.jobSighting.update({ where: { id: s.id }, data: { missingCount: count } })
      }
    }
    return { goneIds, closedJobIds }
  }

  /** Close the job if no live sighting remains (only board sightings count as authoritative). */
  async maybeCloseJob(jobId: string, now = new Date()): Promise<boolean> {
    const live = await this.prisma.jobSighting.count({ where: { jobId, goneAt: null, boardId: { not: null } } })
    if (live > 0) return false
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { status: true, closedAt: true } })
    if (!job || job.closedAt) return false
    await this.prisma.job.update({
      where: { id: jobId },
      data: { closedAt: now, status: 'closed' }, // v3: jobs.status is lifecycle only; saved/applied live in job_user_states
    })
    return true
  }

  async linkJob(feedKey: string, externalId: string, jobId: string, detailFetched = false): Promise<void> {
    await this.prisma.jobSighting.updateMany({
      where: { feedKey, externalId },
      data: { jobId, ...(detailFetched ? { detailFetchedAt: new Date() } : {}) },
    })
    // Keep jobs.first_seen_at = earliest sighting across feeds
    const earliest = await this.prisma.jobSighting.findFirst({ where: { jobId }, orderBy: { firstSeenAt: 'asc' }, select: { firstSeenAt: true } })
    if (earliest) {
      await this.prisma.job.updateMany({ where: { id: jobId, firstSeenAt: { gt: earliest.firstSeenAt } }, data: { firstSeenAt: earliest.firstSeenAt } })
    }
  }
}
