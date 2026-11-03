import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { requireAdmin, authErrorResponse } from '../../../../lib/auth'
import type { Prisma } from '@jobradar/db'
import { log } from '@jobradar/log'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const { id } = await params
  const company = await prisma.company.findUnique({ where: { id }, include: { boards: true, payEvidence: { orderBy: { observedAt: 'desc' }, take: 20 }, discoveries: true } })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(company)
}

/** Operator controls: anchor, manual tier, status (dormant/watched), tags. Everything else is derived. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const { id } = await params
  try {
    const body = (await req.json()) as { anchor?: boolean; manualTier?: 'hot' | 'warm' | 'cold' | 'dormant' | null; status?: 'watched' | 'dormant' | 'retired'; tags?: string[] }
    const data: Record<string, unknown> = {}
    if (typeof body.anchor === 'boolean') data.anchor = body.anchor
    if (body.manualTier !== undefined) data.manualTier = body.manualTier
    if (body.status) { data.status = body.status; data.statusReason = 'manual' }
    if (Array.isArray(body.tags)) data.tags = body.tags
    const company = await prisma.company.update({ where: { id }, data: data as Prisma.CompanyUpdateInput, include: { boards: true } })
    // bring boards forward when made hot
    if (body.manualTier === 'hot' || body.anchor === true) {
      await prisma.companyBoard.updateMany({ where: { companyId: id, enabled: true }, data: { nextPollAt: new Date() } })
    }
    return NextResponse.json(company)
  } catch (err) {
    log.error('PATCH /api/companies/:id error:', err)
    return NextResponse.json({ error: 'Failed to update company' }, { status: 500 })
  }
}
