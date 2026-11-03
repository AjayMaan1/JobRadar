import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../../lib/auth'
import { limitUser } from '../../../../../lib/rate-limit'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../../../lib/services'

/**
 * Answer a keyword_confirm question: { yes: boolean, context?: string }.
 * "yes" records a confirmed fact and enqueues grounded follow-up suggestions (skills-section add + a bullet drafted
 * from the user's own words). The web tier never calls the LLM itself.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'suggest'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { yes?: boolean; context?: string }
    const { suggestions, tasks, queues } = services()
    const r = await suggestions.confirmFact(id, user.id, { yes: Boolean(body.yes), context: typeof body.context === 'string' ? body.context.slice(0, 600) : '' })
    // With context and an LLM on the worker, draft the bullet there (the web-side service has llm=null and only created the skills add).
    let taskId: string | null = null
    if (body.yes && (body.context ?? '').trim().length >= 15) {
      const task = await tasks.create('suggest', user.id)
      await queues.suggest.add('suggestions', { taskId: task.id, reportId: r.suggestion.reportId, userId: user.id, type: 'suggestions' }, { ...USER_TASK_OPTS, jobId: `suggest:${r.suggestion.reportId}:${Date.now()}` })
      taskId = task.id
    }
    return NextResponse.json({ suggestion: r.suggestion, created: r.created, taskId })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    return authErrorResponse(err) ?? NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
