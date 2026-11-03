import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { serializeJob } from '../../../../../lib/job-serializer'
import { authErrorResponse, requireUser } from '../../../../../lib/auth'
import { services } from '../../../../../lib/services'
import { log } from '@jobradar/log'

/**
 * "Mark as applied" (backlog C10-4): records exactly what was sent. Body (all optional):
 * { resumeVersionId, headlineUsed, aboutUsed, coverNote, answers: [{question, answer}], submittedVia, status, note,
 *   followUpAt (ISO | null) | followUpInDays (GH-5 reminder) }
 * Idempotent per (user, job); later calls update status/events (interviewing, offer, rejected, withdrawn).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const existing = await prisma.job.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const status = ['applied', 'interviewing', 'offer', 'rejected', 'withdrawn'].includes(String(body.status)) ? (body.status as 'applied') : 'applied'
    const application = await services().applyKit.recordApplication(id, user.id, {
      resumeVersionId: typeof body.resumeVersionId === 'string' ? body.resumeVersionId : null,
      headlineUsed: typeof body.headlineUsed === 'string' ? body.headlineUsed.slice(0, 200) : null,
      aboutUsed: typeof body.aboutUsed === 'string' ? body.aboutUsed.slice(0, 2000) : null,
      coverNote: typeof body.coverNote === 'string' ? body.coverNote.slice(0, 5000) : null,
      answers: Array.isArray(body.answers) ? (body.answers as Array<{ question: string; answer: string }>).filter((a) => a && typeof a.question === 'string').slice(0, 40) : null,
      submittedVia: body.submittedVia === 'extension' ? 'extension' : 'manual',
      status,
      note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
      followUpAt: body.followUpAt === null ? null : typeof body.followUpAt === 'string' && !Number.isNaN(Date.parse(body.followUpAt)) ? body.followUpAt : typeof body.followUpInDays === 'number' && body.followUpInDays > 0 ? new Date(Date.now() + Math.min(90, body.followUpInDays) * 86400_000).toISOString() : undefined,
    })
    return NextResponse.json(serializeJob(existing, 'applied', { application: { id: application.id, status: application.status, appliedAt: application.appliedAt?.toISOString() ?? null, followUpAt: application.followUpAt?.toISOString() ?? null, coverNote: application.coverNote, resumeVersionId: application.resumeVersionId, headlineUsed: application.headlineUsed, aboutUsed: application.aboutUsed, submittedVia: application.submittedVia, events: (application.events as Array<{ at: string; type: string; note: string | null }>) ?? [] } }))
  } catch (err) {
    const a = authErrorResponse(err); if (a) return a
    log.error('POST /api/jobs/:id/apply error:', err)
    return NextResponse.json({ error: (err as Error).message ?? 'Failed to mark as applied' }, { status: 500 })
  }
}
