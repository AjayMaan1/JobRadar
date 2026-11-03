import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { MIN_DESCRIPTION_CHARS, manualDescriptionAllowed } from '@jobradar/resume'
import { log } from '@jobradar/log'
import { requireUser, unauthorized, Unauthorized } from '../../../../../lib/auth'
import { limitUser } from '../../../../../lib/rate-limit'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../../../lib/services'

/**
 * User pastes the job description (hydration fallback). Audit NEW-03: stored as `descriptionManual` with
 * provenance, accepted only when the crawled text is unusable, never overwriting it. Re-extracts requirements
 * in the worker.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'jd'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { description?: string }
    const text = (body.description ?? '').trim()
    if (text.length < MIN_DESCRIPTION_CHARS) return NextResponse.json({ error: `Description too short (min ${MIN_DESCRIPTION_CHARS} characters)` }, { status: 400 })
    if (text.length > 60_000) return NextResponse.json({ error: 'Description too long (max 60,000 characters)' }, { status: 413 })
    const job = await prisma.job.findUnique({ where: { id: jobId } })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (!manualDescriptionAllowed(job)) return NextResponse.json({ error: 'This job already has a usable description', code: 'has_description' }, { status: 409 })
    await prisma.job.update({ where: { id: jobId }, data: { descriptionManual: text, descriptionManualBy: user.id, descriptionManualAt: new Date() } })
    const { tasks, queues } = services()
    const task = await tasks.create('jd-analyze', user.id)
    await queues.jdAnalyze.add('analyze', { taskId: task.id, jobId, userId: user.id, force: true }, { ...USER_TASK_OPTS, jobId: `jd:${jobId}:${Date.now()}` })
    return NextResponse.json({ taskId: task.id }, { status: 202 })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    if (err instanceof Unauthorized) return unauthorized()
    log.error('POST /api/jobs/:id/jd failed', err as Error, { jobId })
    return NextResponse.json({ error: 'Failed to save description' }, { status: 500 })
  }
}
