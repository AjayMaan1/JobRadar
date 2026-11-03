import { NextResponse } from 'next/server'
import { Queue } from 'bullmq'
import { prisma } from '@jobradar/db'
import { requireAdmin, authErrorResponse } from '../../../lib/auth'
import { log } from '@jobradar/log'

/**
 * Manual refresh: bring every hot/warm board's next_poll_at to now (dispatcher picks them up within
 * 30s) and enqueue one crawl per runnable aggregator source. Does not bypass rate limits or budgets.
 */
export async function POST() {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' }
  const crawlQueue = new Queue('crawl', { connection })
  try {
    const boards = await prisma.companyBoard.updateMany({
      where: { enabled: true, status: 'active', backoffUntil: null, company: { status: 'watched', OR: [{ tier: { in: ['hot', 'warm'] } }, { manualTier: { in: ['hot', 'warm'] } }] } },
      data: { nextPollAt: new Date() },
    })
    const job = await crawlQueue.add('crawl-all', { type: 'all' }, { jobId: `crawl-all:${Math.floor(Date.now() / 600_000)}`, removeOnComplete: 5, removeOnFail: 5 })
    return NextResponse.json({ queued: true, jobId: job.id, boardsDue: boards.count })
  } catch (err) {
    log.error('POST /api/crawl error:', err)
    return NextResponse.json({ error: 'Failed to enqueue crawl' }, { status: 500 })
  } finally {
    await crawlQueue.close()
  }
}
