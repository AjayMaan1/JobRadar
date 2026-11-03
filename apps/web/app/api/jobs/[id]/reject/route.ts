import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { serializeJob } from '../../../../../lib/job-serializer'
import { authErrorResponse, requireUser } from '../../../../../lib/auth'
import { log } from '@jobradar/log'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const job = await prisma.job.findUnique({ where: { id } })
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.jobUserState.upsert({ where: { userId_jobId: { userId: user.id, jobId: id } }, create: { userId: user.id, jobId: id, state: 'rejected' }, update: { state: 'rejected' } })
    return NextResponse.json(serializeJob(job, 'rejected'))
  } catch (err) {
    const a = authErrorResponse(err); if (a) return a
    log.error('POST /api/jobs/:id/reject error:', err)
    return NextResponse.json({ error: 'Failed to reject job' }, { status: 500 })
  }
}
