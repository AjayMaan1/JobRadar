import { NextRequest, NextResponse } from 'next/server'
import { log } from '@jobradar/log'
import { authErrorResponse, requireUser } from '../../../lib/auth'
import { limitUser } from '../../../lib/rate-limit'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../lib/services'

/**
 * Dynamic preferences (docs/HLD-dynamic-preferences.md).
 *   GET  → the active document (created from the owner's legacy env / the default preset on first call) + warnings
 *   PUT  → validate, save as a new version, enqueue re-evaluation of the user's open jobs → 202 { taskId, version }
 */
export async function GET() {
  try {
    const user = await requireUser()
    const { preferences, evals } = services()
    const saved = await preferences.ensure(user.id)
    const evaluated = await (await import('@jobradar/db')).prisma.jobUserEval.count({ where: { userId: user.id } })
    evals.invalidateUsers()
    return NextResponse.json({ ...saved, evaluated, engine: process.env.PREFS_ENGINE === 'legacy' ? 'legacy' : 'evals' })
  } catch (err) {
    return authErrorResponse(err) ?? (log.error('GET /api/preferences failed', err as Error), NextResponse.json({ error: 'Failed' }, { status: 500 }))
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'mutate'); if (rl) return rl
    const body = (await req.json().catch(() => null)) as { doc?: unknown; note?: string } | null
    if (!body?.doc) return NextResponse.json({ error: 'Body must be { doc }' }, { status: 400 })
    const { preferences, evals, tasks, queues } = services()
    let saved
    try { saved = await preferences.save(user.id, body.doc, { source: 'manual', note: body.note?.slice(0, 200) }) }
    catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 400 }) }
    evals.invalidateUsers()
    const task = await tasks.create('prefs-reeval', user.id)
    await queues.prefsReeval.add('reeval', { taskId: task.id, userId: user.id, version: saved.version }, { ...USER_TASK_OPTS, jobId: `prefs:${user.id}:${saved.version}` })
    return NextResponse.json({ ...saved, taskId: task.id }, { status: 202 })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    return authErrorResponse(err) ?? (log.error('PUT /api/preferences failed', err as Error), NextResponse.json({ error: 'Failed' }, { status: 500 }))
  }
}
