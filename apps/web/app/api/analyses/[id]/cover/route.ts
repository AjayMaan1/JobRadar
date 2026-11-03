import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../../lib/auth'
import { limitUser } from '../../../../../lib/rate-limit'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../../../lib/services'

/** Draft a grounded cover note for this report's job (GH-8) → 202 { taskId }. Body: { tone? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'suggest'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { tone?: string }
    const tone = ['conservative', 'balanced', 'assertive'].includes(String(body.tone)) ? (body.tone as 'balanced') : 'balanced'
    const { tasks, queues, analysis } = services()
    if (!(await analysis.getReport(id, user.id))) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    const task = await tasks.create('suggest', user.id)
    await queues.suggest.add('cover', { taskId: task.id, reportId: id, userId: user.id, type: 'cover', tone }, { ...USER_TASK_OPTS, jobId: `cover:${id}:${Date.now()}` })
    return NextResponse.json({ taskId: task.id }, { status: 202 })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed to start' }, { status: 500 })
  }
}
