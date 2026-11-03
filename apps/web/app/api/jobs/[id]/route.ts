import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { serializeJob } from '../../../../lib/job-serializer'
import { authErrorResponse, requireUser } from '../../../../lib/auth'
import { log } from '@jobradar/log'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const user = await requireUser()
    const job = await prisma.job.findUnique({ where: { id }, include: { userStates: { where: { userId: user.id } }, applications: { where: { userId: user.id } } } })
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { userStates, applications, ...row } = job
    const app = applications[0]
    return NextResponse.json(serializeJob(row, (userStates[0]?.state as 'saved' | 'applied' | 'rejected' | undefined) ?? null, app ? { application: { id: app.id, status: app.status, appliedAt: app.appliedAt?.toISOString() ?? null, followUpAt: app.followUpAt?.toISOString() ?? null, coverNote: app.coverNote, resumeVersionId: app.resumeVersionId, headlineUsed: app.headlineUsed, aboutUsed: app.aboutUsed, submittedVia: app.submittedVia, events: (app.events as Array<{ at: string; type: string; note: string | null }>) ?? [] } } : {}))
  } catch (err) {
    const a = authErrorResponse(err); if (a) return a
    log.error('GET /api/jobs/:id error:', err)
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 })
  }
}
