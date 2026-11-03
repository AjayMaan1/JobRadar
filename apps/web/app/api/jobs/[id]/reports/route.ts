import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { requireUser, unauthorized, Unauthorized } from '../../../../../lib/auth'
import { services } from '../../../../../lib/services'

/** Latest match report for this user + job (so the modal can show a score without re-running). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  try {
    const user = await requireUser()
    const latest = await prisma.atsReport.findFirst({ where: { jobId, resumeVersion: { resume: { userId: user.id } } }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    if (!latest) return NextResponse.json({ report: null })
    const report = await services().analysis.getReport(latest.id, user.id)
    return NextResponse.json({ report })
  } catch (err) {
    if (err instanceof Unauthorized) return unauthorized()
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
