import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../../../lib/auth'
import { limitUser } from '../../../../../../lib/rate-limit'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../../../../lib/services'

/** Apply a preset (keeps your home/role unless { replaceHome: true }) → new version + re-evaluation task. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'mutate'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { replaceHome?: boolean }
    const { preferences, evals, tasks, queues } = services()
    let saved
    try { saved = await preferences.applyPreset(user.id, id, { replaceHome: Boolean(body.replaceHome) }) }
    catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 400 }) }
    evals.invalidateUsers()
    const task = await tasks.create('prefs-reeval', user.id)
    await queues.prefsReeval.add('reeval', { taskId: task.id, userId: user.id, version: saved.version }, { ...USER_TASK_OPTS, jobId: `prefs:${user.id}:${saved.version}` })
    return NextResponse.json({ ...saved, taskId: task.id }, { status: 202 })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
