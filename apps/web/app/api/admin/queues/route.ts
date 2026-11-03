import { NextRequest, NextResponse } from 'next/server'
import { log, withTimeout } from '@jobradar/log'
import { requireAdmin, authErrorResponse } from '../../../../lib/auth'
import { services } from '../../../../lib/services'

/**
 * Dead-letter / queue operations for admins (GH-3, dependency-free alternative to bull-board):
 *   GET  → per-queue counts + the most recent failed jobs (reason, attempts, data keys — never payload text)
 *   POST { action: retry|remove|clean, queue, jobId? } → retry/remove one failed job, or clean all failed
 */
export async function GET() {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const { bullQueues, mode, inline } = services()
  if (!bullQueues) return NextResponse.json({ mode, queues: [{ name: 'inline', counts: { waiting: inline?.pending.count ?? 0, active: 0, failed: 0, delayed: 0, completed: 0 }, failed: [] }] })
  try {
    const queues = await withTimeout(Promise.all(bullQueues.map(async (q) => {
      const counts = await q.getJobCounts('waiting', 'active', 'failed', 'delayed', 'completed')
      const failed = await q.getFailed(0, 24)
      return {
        name: q.name,
        counts,
        failed: failed.map((j) => ({ id: j.id, name: j.name, attemptsMade: j.attemptsMade, failedReason: (j.failedReason ?? '').slice(0, 300), finishedOn: j.finishedOn ? new Date(j.finishedOn).toISOString() : null, dataKeys: Object.keys((j.data as Record<string, unknown>) ?? {}), taskId: (j.data as { taskId?: string })?.taskId ?? null, userId: (j.data as { userId?: string })?.userId ?? null })),
      }
    })), 5000, 'queue inspection')
    return NextResponse.json({ mode, queues })
  } catch (err) {
    log.error('GET /api/admin/queues failed', err as Error)
    return NextResponse.json({ error: 'Queue inspection failed (Redis?)' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const body = (await req.json().catch(() => ({}))) as { action?: string; queue?: string; jobId?: string }
  const { bullQueues } = services()
  if (!bullQueues) return NextResponse.json({ error: 'No BullMQ queues in inline mode' }, { status: 400 })
  const q = bullQueues.find((x) => x.name === body.queue)
  if (!q) return NextResponse.json({ error: 'Unknown queue' }, { status: 404 })
  try {
    if (body.action === 'clean') {
      const removed = await q.clean(0, 1000, 'failed')
      log.warn('admin cleaned failed jobs', { queue: q.name, removed: removed.length, by: admin.id })
      return NextResponse.json({ removed: removed.length })
    }
    if (!body.jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })
    const job = await q.getJob(body.jobId)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (body.action === 'retry') { await job.retry(); log.info('admin retried job', { queue: q.name, jobId: body.jobId, by: admin.id }); return NextResponse.json({ retried: true }) }
    if (body.action === 'remove') { await job.remove(); log.info('admin removed job', { queue: q.name, jobId: body.jobId, by: admin.id }); return NextResponse.json({ removed: true }) }
    return NextResponse.json({ error: 'action must be retry | remove | clean' }, { status: 400 })
  } catch (err) {
    log.error('POST /api/admin/queues failed', err as Error)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
