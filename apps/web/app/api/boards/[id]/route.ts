import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { requireAdmin, authErrorResponse } from '../../../../lib/auth'
import type { Prisma } from '@jobradar/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const { id } = await params
  const body = (await req.json()) as { enabled?: boolean; status?: 'active' | 'disabled'; pollNow?: boolean }
  const data: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled
  if (body.status) {
    data.status = body.status
    if (body.status === 'active') { data.consecutiveFailures = 0; data.blockedCount7d = 0; data.backoffUntil = null; data.lastError = null }
  }
  if (body.pollNow) { data.nextPollAt = new Date(); data.backoffUntil = null }
  const board = await prisma.companyBoard.update({ where: { id }, data: data as Prisma.CompanyBoardUpdateInput })
  return NextResponse.json(board)
}
