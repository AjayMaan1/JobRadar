import type { PrismaClient } from '@jobradar/db'
import { WATCHLIST_CONFIG } from './config.js'

/**
 * DB-driven scheduler: claim due boards with SKIP LOCKED, push next_poll_at forward by a short
 * lease so a crashed worker doesn't lose the board, and return ids for the poll-board queue.
 * The actual next interval is set by BoardPollService after the fetch.
 */
export class DispatcherService {
  constructor(private prisma: PrismaClient) {}

  async claimDue(limit = WATCHLIST_CONFIG.dispatchBatch): Promise<string[]> {
    const leaseMinutes = 10
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH due AS (
        SELECT b.id
        FROM company_boards b
        JOIN companies c ON c.id = b.company_id
        WHERE b.enabled = true
          AND b.status IN ('active','failing')
          AND b.next_poll_at <= now()
          AND (b.backoff_until IS NULL OR b.backoff_until <= now())
          AND c.status IN ('watched','probing','dormant')
        ORDER BY
          CASE COALESCE(c.manual_tier, c.tier) WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 WHEN 'cold' THEN 2 ELSE 3 END,
          b.next_poll_at ASC
        LIMIT ${limit}
        FOR UPDATE OF b SKIP LOCKED
      )
      UPDATE company_boards b
      SET next_poll_at = now() + (${leaseMinutes} * interval '1 minute')
      FROM due
      WHERE b.id = due.id
      RETURNING b.id
    `
    return rows.map((r) => r.id)
  }

  async lagSeconds(): Promise<number> {
    const row = await this.prisma.$queryRaw<Array<{ lag: number | null }>>`
      SELECT EXTRACT(EPOCH FROM (now() - MIN(b.next_poll_at)))::float AS lag
      FROM company_boards b JOIN companies c ON c.id = b.company_id
      WHERE b.enabled AND b.status IN ('active','failing') AND b.next_poll_at <= now()
        AND c.status IN ('watched','probing')
    `
    return Math.max(0, row[0]?.lag ?? 0)
  }
}
