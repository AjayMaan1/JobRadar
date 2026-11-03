import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../lib/auth'
import { limitUser } from '../../../../lib/rate-limit'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../../lib/services'

/** { version } → re-save that snapshot as a new version + re-evaluation task. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'mutate'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { version?: number }
    if (!Number.isInteger(body.version)) return NextResponse.json({ error: 'version required' }, { status: 400 })
    const { preferences, evals, tasks, queues } = services()
    let saved
    try { saved = await preferences.revert(user.id, body.version!) } catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 404 }) }
    evals.invalidateUsers()
    const task = await tasks.create('prefs-reeval', user.id)
    await queues.prefsReeval.add('reeval', { taskId: task.id, userId: user.id, version: saved.version }, { ...USER_TASK_OPTS, jobId: `prefs:${user.id}:${saved.version}` })
    return NextResponse.json({ ...saved, taskId: task.id }, { status: 202 })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
