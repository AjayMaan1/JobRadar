import { NextRequest } from 'next/server'
import { log } from '@jobradar/log'
import { extError, extJson, preflight, requireExtensionUser } from '../../../../lib/ext'
import { limitUser } from '../../../../lib/rate-limit'
import { services } from '../../../../lib/services'

export async function OPTIONS(req: NextRequest) { return preflight(req) }

/** After the user clicked Submit on the employer's site: record exactly what the extension filled. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireExtensionUser(req)
    const rl = await limitUser(user.id, 'mutate'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { jobId?: string; resumeVersionId?: string | null; answers?: Array<{ question: string; answer: string }>; coverNote?: string | null; headlineUsed?: string | null; aboutUsed?: string | null; followUpInDays?: number }
    if (!body.jobId) return extJson(req, { error: 'jobId required' }, { status: 400 })
    const application = await services().applyKit.recordApplication(body.jobId, user.id, {
      resumeVersionId: body.resumeVersionId ?? null,
      headlineUsed: body.headlineUsed?.slice(0, 200) ?? null,
      aboutUsed: body.aboutUsed?.slice(0, 2000) ?? null,
      coverNote: body.coverNote?.slice(0, 5000) ?? null,
      answers: Array.isArray(body.answers) ? body.answers.filter((a) => a && typeof a.question === 'string').slice(0, 40) : null,
      submittedVia: 'extension',
      status: 'applied',
      note: 'submitted on the employer site via the browser extension',
      followUpAt: typeof body.followUpInDays === 'number' && body.followUpInDays > 0 ? new Date(Date.now() + Math.min(90, body.followUpInDays) * 86400_000).toISOString() : undefined,
    })
    log.info('application recorded via extension', { userId: user.id, jobId: body.jobId })
    return extJson(req, { application: { id: application.id, status: application.status, appliedAt: application.appliedAt } }, { status: 201 })
  } catch (err) {
    return extError(req, err)
  }
}
