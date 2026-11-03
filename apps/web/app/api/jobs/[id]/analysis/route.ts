import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { requireUser, unauthorized, Unauthorized } from '../../../../../lib/auth'
import { limitUser } from '../../../../../lib/rate-limit'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../../../lib/services'
import { log } from '@jobradar/log'

/** { resumeVersionId? } → 202 { taskId }. Defaults to the master resume's current version. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'analysis'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { resumeVersionId?: string }
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    let versionId = body.resumeVersionId
    if (!versionId) {
      const master = await prisma.resume.findFirst({ where: { userId: user.id, isMaster: true } })
      versionId = master?.currentVersionId ?? undefined
      if (!versionId) return NextResponse.json({ error: 'Upload a resume first', code: 'no_resume' }, { status: 409 })
    }
    const version = await prisma.resumeVersion.findFirst({ where: { id: versionId, resume: { userId: user.id } }, select: { id: true } })
    if (!version) return NextResponse.json({ error: 'Resume version not found' }, { status: 404 })

    const { tasks, queues } = services()
    const task = await tasks.create('ats-score', user.id)
    await queues.atsScore.add('score', { taskId: task.id, resumeVersionId: version.id, jobId, userId: user.id }, { ...USER_TASK_OPTS, jobId: `score:${version.id}:${jobId}:${Date.now()}` })
    return NextResponse.json({ taskId: task.id, resumeVersionId: version.id }, { status: 202 })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    if (err instanceof Unauthorized) return unauthorized()
    log.error('POST /api/jobs/:id/analysis error:', err)
    return NextResponse.json({ error: 'Failed to start analysis' }, { status: 500 })
  }
}
