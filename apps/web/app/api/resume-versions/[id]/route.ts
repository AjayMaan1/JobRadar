import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../lib/auth'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../../lib/services'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const v = await services().versions.get(id, user.id)
    if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(v)
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/** { rerender: true } → render again (e.g. after a failed render or renderer install). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const body = (await req.json().catch(() => ({}))) as { rerender?: boolean }
    const { versions, tasks, queues } = services()
    if (!(await versions.get(id, user.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!body.rerender) return NextResponse.json({ error: 'Nothing to do' }, { status: 400 })
    const task = await tasks.create('resume-render', user.id)
    await queues.resumeRender.add('render', { taskId: task.id, versionId: id, userId: user.id }, { ...USER_TASK_OPTS, jobId: `render:${id}:${Date.now()}` })
    return NextResponse.json({ taskId: task.id }, { status: 202 })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
