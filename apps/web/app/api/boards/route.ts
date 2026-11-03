import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { requireAdmin, authErrorResponse } from '../../../lib/auth'
import type { Prisma } from '@jobradar/db'

export async function GET(req: NextRequest) {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const rows = await prisma.companyBoard.findMany({
    where: status ? { status: status as Prisma.CompanyBoardWhereInput['status'] } : {},
    include: { company: { select: { id: true, name: true, tier: true, manualTier: true, anchor: true, status: true } }, fetchRuns: { orderBy: { startedAt: 'desc' }, take: 3 } },
    orderBy: [{ status: 'asc' }, { nextPollAt: 'asc' }],
    take: 500,
  })
  return NextResponse.json({ data: rows })
}
