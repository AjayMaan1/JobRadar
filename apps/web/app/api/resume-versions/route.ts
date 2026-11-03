import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../lib/auth'
import { limitUser } from '../../../lib/rate-limit'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../lib/services'

/**
 * Create a version and render it (C9-2..4). Two shapes:
 *  - suggestion flow (C9-1): { baseVersionId, jobId, acceptedSuggestionIds: [], headline?, about? }
 *  - visual editor (HLD-resume-editor): { baseVersionId, jobId?, content, acceptedSuggestionIds?, note? }
 *    → tailored version when jobId is given, else a correction that becomes the resume's current version.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'render'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { baseVersionId?: string; jobId?: string; acceptedSuggestionIds?: string[]; headline?: string | null; about?: string | null; content?: unknown; note?: string | null }
    const { versions, tasks, queues } = services()
    if (body.content !== undefined) {
      if (!body.baseVersionId) return NextResponse.json({ error: 'baseVersionId is required' }, { status: 400 })
      let version
      try {
        version = await versions.createFromEditor({ userId: user.id, baseVersionId: body.baseVersionId, jobId: body.jobId ?? null, content: body.content, acceptedSuggestionIds: Array.isArray(body.acceptedSuggestionIds) ? body.acceptedSuggestionIds.map(String) : [], note: body.note ?? null })
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message.slice(0, 400) }, { status: 400 })
      }
      const task = await tasks.create('resume-render', user.id)
      await queues.resumeRender.add('render', { taskId: task.id, versionId: version.id, userId: user.id }, { ...USER_TASK_OPTS, jobId: `render:${version.id}` })
      if (!body.jobId) {
        await queues.embed.add('version', { type: 'version', versionId: version.id }, { jobId: `embed:version:${version.id}`, removeOnComplete: 20, removeOnFail: 20 }).catch(() => undefined)
        await queues.embed.add('profile', { type: 'profile', userId: user.id }, { jobId: `embed:profile:${user.id}:${Date.now()}`, removeOnComplete: 20, removeOnFail: 20 }).catch(() => undefined)
      }
      const changeLog = version.changeLog as { changes?: unknown[]; grounding?: unknown[] } | null
      return NextResponse.json({ versionId: version.id, taskId: task.id, kind: version.kind, changes: changeLog?.changes?.length ?? 0, grounding: changeLog?.grounding ?? [] }, { status: 202 })
    }
    if (!body.baseVersionId || !body.jobId) return NextResponse.json({ error: 'baseVersionId and jobId are required' }, { status: 400 })
    const version = await versions.createTailored({
      userId: user.id,
      baseVersionId: body.baseVersionId,
      jobId: body.jobId,
      acceptedSuggestionIds: Array.isArray(body.acceptedSuggestionIds) ? body.acceptedSuggestionIds.map(String) : [],
      headline: typeof body.headline === 'string' ? body.headline.trim().slice(0, 200) : null,
      about: typeof body.about === 'string' ? body.about.trim().slice(0, 2000) : null,
    })
    const task = await tasks.create('resume-render', user.id)
    await queues.resumeRender.add('render', { taskId: task.id, versionId: version.id, userId: user.id }, { ...USER_TASK_OPTS, jobId: `render:${version.id}` })
    return NextResponse.json({ versionId: version.id, taskId: task.id }, { status: 202 })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    return authErrorResponse(err) ?? NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
