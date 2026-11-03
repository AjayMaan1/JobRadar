import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../../lib/auth'
import { limitUser } from '../../../../../lib/rate-limit'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../../../lib/services'

/** Opt-in headline/about variants (C8): { kind: 'headline'|'about', tone? } → 202 { taskId }. Never runs unless the user asks. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'suggest'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { kind?: string; tone?: string }
    const kind = body.kind === 'about' ? 'about' : body.kind === 'headline' ? 'headline' : null
    if (!kind) return NextResponse.json({ error: 'kind must be headline or about' }, { status: 400 })
    const tone = ['conservative', 'balanced', 'assertive'].includes(String(body.tone)) ? (body.tone as 'balanced') : 'balanced'
    const { tasks, queues, analysis } = services()
    if (!(await analysis.getReport(id, user.id))) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    const task = await tasks.create('suggest', user.id)
    await queues.suggest.add('variants', { taskId: task.id, reportId: id, userId: user.id, type: 'variants', kind, tone }, { ...USER_TASK_OPTS, jobId: `variants:${id}:${kind}:${Date.now()}` })
    return NextResponse.json({ taskId: task.id }, { status: 202 })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed to start' }, { status: 500 })
  }
}
