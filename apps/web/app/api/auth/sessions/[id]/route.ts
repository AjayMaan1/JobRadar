import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { authErrorResponse, requireUser } from '../../../../../lib/auth'

/** Revoke one session (must belong to the caller). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const r = await prisma.session.deleteMany({ where: { id, userId: user.id } })
    if (!r.count) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ revoked: 1 })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
