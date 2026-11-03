import { NextRequest, NextResponse } from 'next/server'
import { requireUser, unauthorized, Unauthorized } from '../../../../lib/auth'
import { limitUser } from '../../../../lib/rate-limit'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../../lib/services'
import { log } from '@jobradar/log'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const r = await services().resumes.get(id, user.id)
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(r)
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    if (err instanceof Unauthorized) return unauthorized()
    log.error('GET /api/resumes/:id error:', err)
    return NextResponse.json({ error: 'Failed to load resume' }, { status: 500 })
  }
}

/**
 * { content } → save a user correction as a new immutable version (kind=correction)
 * { isMaster: true } → make this the master resume (profile re-seeded)
 * { reparse: true } → run the parser again (new master version)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'mutate'); if (rl) return rl
    const body = (await req.json()) as { content?: unknown; isMaster?: boolean; reparse?: boolean; label?: string }
    const { resumes, tasks, queues } = services()
    if (body.content !== undefined) {
      try {
        const version = await resumes.correct(id, user.id, body.content)
        await queues.embed.add('version', { type: 'version', versionId: version.id }, { jobId: `embed:version:${version.id}`, removeOnComplete: 20, removeOnFail: 20 }).catch(() => undefined)
        await queues.embed.add('profile', { type: 'profile', userId: user.id }, { jobId: `embed:profile:${user.id}:${Date.now()}`, removeOnComplete: 20, removeOnFail: 20 }).catch(() => undefined)
        return NextResponse.json({ versionId: version.id })
      } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
        return NextResponse.json({ error: `Invalid resume content: ${(err as Error).message.slice(0, 300)}` }, { status: 400 })
      }
    }
    if (body.isMaster) await resumes.setMaster(id, user.id)
    if (body.reparse) {
      const task = await tasks.create('resume-parse', user.id)
      await queues.resumeParse.add('parse', { taskId: task.id, resumeId: id, userId: user.id }, { ...USER_TASK_OPTS, jobId: `parse:${id}:${Date.now()}` })
      return NextResponse.json({ taskId: task.id }, { status: 202 })
    }
    const r = await resumes.get(id, user.id)
    return NextResponse.json(r)
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    if (err instanceof Unauthorized) return unauthorized()
    log.error('PATCH /api/resumes/:id error:', err)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const ok = await services().resumes.delete(id, user.id)
    return ok ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    if (err instanceof Unauthorized) return unauthorized()
    log.error('DELETE /api/resumes/:id error:', err)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
