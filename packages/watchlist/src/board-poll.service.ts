import type { PrismaClient, CompanyBoard, Company } from '@jobradar/db'
import { engineFor, type FetchGateway, type BoardItem, type BoardRef, type RawJob } from '@jobradar/crawler'
import { SightingService } from './sighting.service.js'
import { nextPollAtFor, WATCHLIST_CONFIG } from './config.js'
import type { EnrichPayload, PollOutcome } from './types.js'
import { log } from '@jobradar/log'

export function effectiveTier(company: Pick<Company, 'tier' | 'manualTier' | 'anchor'>): 'hot' | 'warm' | 'cold' | 'dormant' {
  if (company.manualTier) return company.manualTier
  if (company.anchor && company.tier === 'dormant') return 'warm'
  return company.tier
}

export function boardItemToRaw(board: CompanyBoard, company: Company, item: BoardItem): RawJob {
  return {
    title: item.title,
    company: company.name,
    applyUrl: item.applyUrl ?? item.url,
    sourceUrl: item.url,
    description: item.description ?? '',
    postedAt: item.postedAt ?? undefined,
    salary: item.salaryHint ?? undefined,
    location: item.location ?? undefined,
    tags: item.tags ?? [],
    sourceFingerprint: `${board.atsType}-${board.slug}-${item.externalId}`,
    sourceName: `${board.atsType} board`,
  }
}

export class BoardPollService {
  private sightings: SightingService

  constructor(private prisma: PrismaClient, private gateway: FetchGateway) {
    this.sightings = new SightingService(prisma)
  }

  async poll(boardId: string, purpose: 'list' | 'probe' = 'list'): Promise<PollOutcome> {
    const board = await this.prisma.companyBoard.findUnique({ where: { id: boardId }, include: { company: true } })
    if (!board) return { boardId, outcome: 'missing', newCount: 0, changedCount: 0, goneCount: 0, closedCount: 0, enrich: [], nextPollAt: new Date(Date.now() + 3600_000) }
    const company = board.company
    const tier = effectiveTier(company)
    const schedule = () => nextPollAtFor(tier, board.costClass, board.lastPostingCount, board.id)

    if (!board.enabled || board.status === 'disabled' || board.status === 'blocked') {
      const next = new Date(Date.now() + 7 * 86400_000)
      await this.prisma.companyBoard.update({ where: { id: boardId }, data: { nextPollAt: next } })
      return { boardId, outcome: 'disabled', newCount: 0, changedCount: 0, goneCount: 0, closedCount: 0, enrich: [], nextPollAt: next }
    }
    if (board.backoffUntil && board.backoffUntil.getTime() > Date.now()) {
      await this.prisma.companyBoard.update({ where: { id: boardId }, data: { nextPollAt: board.backoffUntil } })
      return { boardId, outcome: 'backoff', newCount: 0, changedCount: 0, goneCount: 0, closedCount: 0, enrich: [], nextPollAt: board.backoffUntil }
    }

    const engine = engineFor(board.atsType)
    if (!engine) {
      const next = new Date(Date.now() + 86400_000)
      await this.prisma.companyBoard.update({ where: { id: boardId }, data: { nextPollAt: next, lastError: `no engine for ${board.atsType}` } })
      return { boardId, outcome: 'no_engine', newCount: 0, changedCount: 0, goneCount: 0, closedCount: 0, enrich: [], nextPollAt: next }
    }

    const ref: BoardRef = {
      id: board.id,
      atsType: board.atsType,
      slug: board.slug,
      apiUrl: board.apiUrl,
      careersUrl: board.careersUrl,
      queryScope: (board.queryScope as Record<string, unknown> | null) ?? null,
      etag: board.etag,
      lastModified: board.lastModified,
      bodyHash: board.bodyHash,
      companyName: company.name,
    }

    const { res, items } = await engine.list(ref, this.gateway, purpose)
    const now = new Date()
    const base = { lastPollAt: now, lastStatusCode: res.status ?? null }

    switch (res.outcome) {
      case 'skipped': {
        const next = new Date(Date.now() + Math.min(res.retryAfterMs ?? 15 * 60_000, 6 * 3600_000))
        await this.prisma.companyBoard.update({ where: { id: boardId }, data: { ...base, nextPollAt: next, lastError: res.error ?? 'skipped' } })
        return { boardId, outcome: 'skipped', newCount: 0, changedCount: 0, goneCount: 0, closedCount: 0, enrich: [], nextPollAt: next, error: res.error }
      }
      case 'unchanged': {
        const next = schedule()
        // a stable list confirms postings already flagged missing are still gone
        const confirmed = board.suspectDropAt ? { goneIds: [], closedJobIds: [] } : await this.sightings.confirmMissing(`board:${board.id}`)
        await this.prisma.companyBoard.update({
          where: { id: boardId },
          data: { ...base, nextPollAt: next, lastSuccessAt: now, consecutiveFailures: 0, consecutiveUnchanged: { increment: 1 }, backoffUntil: null, status: 'active', lastError: null },
        })
        return { boardId, outcome: 'unchanged', newCount: 0, changedCount: 0, goneCount: confirmed.goneIds.length, closedCount: confirmed.closedJobIds.length, enrich: [], nextPollAt: next }
      }
      case 'changed': {
        if (!items) break
        const r = await this.sightings.reconcile({
          feedKey: `board:${board.id}`,
          boardId: board.id,
          items: items.map((i) => ({ externalId: i.externalId, hashFields: i.hashFields ?? { title: i.title, location: i.location }, postedAt: i.postedAt ?? null })),
          fullList: true,
          previousCount: board.lastPostingCount,
        })
        const next = nextPollAtFor(tier, board.costClass, items.length, board.id)
        await this.prisma.companyBoard.update({
          where: { id: boardId },
          data: {
            ...base,
            nextPollAt: next,
            lastSuccessAt: now,
            lastChangedAt: now,
            consecutiveFailures: 0,
            consecutiveUnchanged: 0,
            backoffUntil: null,
            status: 'active',
            lastError: null,
            etag: res.etag,
            lastModified: res.lastModified,
            bodyHash: res.bodyHash,
            lastPostingCount: r.suspectDrop ? board.lastPostingCount : items.length,
            suspectDropAt: r.suspectDrop ? now : null,
          },
        })
        if (r.suspectDrop) log.warn(`[poll] ${company.name}/${board.atsType}: suspect drop ${board.lastPostingCount} → ${items.length}; closures suspended this poll`)
        const byId = new Map(items.map((i) => [i.externalId, i]))
        const enrich: EnrichPayload[] = []
        const push = (id: string, event: EnrichPayload['event']) => {
          const item = byId.get(id)
          if (!item) return
          enrich.push({
            feedKey: `board:${board.id}`,
            boardId: board.id,
            externalId: id,
            raw: boardItemToRaw(board, company, item),
            item,
            companyId: company.id,
            suppressAlerts: purpose === 'probe',
            isRemoteFlag: item.isRemoteFlag ?? null,
            employmentTypeHints: [item.employmentTypeHint ?? null].filter(Boolean) as string[],
            event,
          })
        }
        r.newIds.forEach((id) => push(id, 'new'))
        r.reappearedIds.forEach((id) => push(id, 'reappeared'))
        r.changedIds.forEach((id) => push(id, 'changed'))
        return { boardId, outcome: 'changed', newCount: r.newIds.length, changedCount: r.changedIds.length, goneCount: r.goneIds.length, closedCount: r.closedJobIds.length, enrich, nextPollAt: next }
      }
      default:
        break
    }

    // error / timeout / not_found / rate_limited / blocked
    const failures = board.consecutiveFailures + 1
    const backoffMin = Math.min(2 ** failures, 360)
    const backoffUntil = new Date(Date.now() + backoffMin * 60_000)
    let status: CompanyBoard['status'] = failures >= 5 ? 'failing' : board.status
    let blocked7d = board.blockedCount7d
    if (res.outcome === 'blocked') {
      blocked7d += 1
      if (blocked7d >= 3) status = 'blocked'
    }
    if (res.outcome === 'not_found' && board.lastSuccessAt && Date.now() - board.lastSuccessAt.getTime() > 30 * 86400_000) status = 'gone'
    if (res.outcome === 'not_found' && !board.lastSuccessAt && failures >= 3) status = 'gone'
    const next = res.outcome === 'rate_limited' && res.retryAfterMs ? new Date(Date.now() + res.retryAfterMs) : backoffUntil
    await this.prisma.companyBoard.update({
      where: { id: boardId },
      data: { ...base, nextPollAt: next, backoffUntil: next, consecutiveFailures: failures, blockedCount7d: blocked7d, status, lastError: (res.error ?? res.outcome).slice(0, 500) },
    })
    if (status === 'blocked') log.error(`[poll] board ${company.name}/${board.atsType} marked BLOCKED — operator review required`)
    return { boardId, outcome: res.outcome, newCount: 0, changedCount: 0, goneCount: 0, closedCount: 0, enrich: [], nextPollAt: next, error: res.error }
  }
}
