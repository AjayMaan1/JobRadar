import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { authErrorResponse, requireUser } from '../../../../lib/auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const body = (await req.json().catch(() => ({}))) as { classes?: string[]; minScore?: number; instant?: boolean; digest?: boolean; enabled?: boolean }
    const existing = await prisma.alertChannel.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const row = await prisma.alertChannel.update({
      where: { id },
      data: {
        ...(Array.isArray(body.classes) ? { classes: body.classes.map(String).filter((c) => ['p1_global_remote', 'p2_india_remote', 'p3_ncr_hybrid'].includes(c)) } : {}),
        ...(body.minScore !== undefined ? { minScore: Math.max(0, Math.min(100, Math.round(Number(body.minScore) || 0))) } : {}),
        ...(body.instant !== undefined ? { instant: Boolean(body.instant) } : {}),
        ...(body.digest !== undefined ? { digest: Boolean(body.digest) } : {}),
        ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
      },
    })
    return NextResponse.json(row)
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const r = await prisma.alertChannel.deleteMany({ where: { id, userId: user.id } })
    if (!r.count) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ deleted: true })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
