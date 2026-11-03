import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { serializeJob } from '../../../../../lib/job-serializer'
import { authErrorResponse, requireUser } from '../../../../../lib/auth'
import { log } from '@jobradar/log'

/** Toggle "saved" for the current user (v3: per-user state; applied jobs stay applied). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const job = await prisma.job.findUnique({ where: { id } })
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const cur = await prisma.jobUserState.findUnique({ where: { userId_jobId: { userId: user.id, jobId: id } } })
    let state: 'saved' | 'applied' | 'rejected' | null
    if (cur?.state === 'applied') state = 'applied'
    else if (cur?.state === 'saved') { await prisma.jobUserState.delete({ where: { userId_jobId: { userId: user.id, jobId: id } } }); state = null }
    else { await prisma.jobUserState.upsert({ where: { userId_jobId: { userId: user.id, jobId: id } }, create: { userId: user.id, jobId: id, state: 'saved' }, update: { state: 'saved' } }); state = 'saved' }
    return NextResponse.json(serializeJob(job, state))
  } catch (err) {
    const a = authErrorResponse(err); if (a) return a
    log.error('POST /api/jobs/:id/save error:', err)
    return NextResponse.json({ error: 'Failed to save job' }, { status: 500 })
  }
}
