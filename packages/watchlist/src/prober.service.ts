import type { PrismaClient } from '@jobradar/db'
import type { FetchGateway } from '@jobradar/crawler'
import { BoardPollService } from './board-poll.service.js'
import type { EnrichPayload } from './types.js'

/**
 * First fetch of a newly resolved board (probe budget). Returns enrich payloads with alerts
 * suppressed; the tiering recompute after enrichment decides watched|dormant + tier.
 */
export class ProberService {
  private poller: BoardPollService

  constructor(private prisma: PrismaClient, gateway: FetchGateway) {
    this.poller = new BoardPollService(prisma, gateway)
  }

  async probeBoard(boardId: string): Promise<{ outcome: string; enrich: EnrichPayload[] }> {
    const r = await this.poller.poll(boardId, 'probe')
    const board = await this.prisma.companyBoard.findUnique({ where: { id: boardId }, include: { company: true } })
    if (board && (r.outcome === 'changed' || r.outcome === 'unchanged')) {
      // Status becomes `watched` now; tier/dormancy are derived by the hourly tiering job AFTER the
      // probe's enrich payloads have been processed (tiering ignores "no postings" for fresh probes).
      await this.prisma.company.update({ where: { id: board.companyId }, data: { lastProbedAt: new Date(), status: 'watched', tier: board.company.anchor ? 'hot' : 'warm' } })
    } else if (board && (r.outcome === 'not_found' || r.outcome === 'blocked')) {
      const remaining = await this.prisma.companyBoard.count({ where: { companyId: board.companyId, status: { in: ['active', 'failing'] }, id: { not: boardId } } })
      if (remaining === 0) {
        await this.prisma.company.update({ where: { id: board.companyId }, data: { status: 'unresolved', statusReason: `probe ${r.outcome}: ${r.error ?? ''}`.slice(0, 300) } })
      }
    }
    return { outcome: r.outcome, enrich: r.enrich.map((e) => ({ ...e, suppressAlerts: true })) }
  }

  async pendingBoards(limit = 50): Promise<string[]> {
    const rows = await this.prisma.companyBoard.findMany({
      where: { enabled: true, status: 'active', lastPollAt: null, company: { status: 'probing' } },
      orderBy: [{ company: { anchor: 'desc' } }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true },
    })
    return rows.map((r) => r.id)
  }
}
