import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../../lib/auth'
import { services } from '../../../../../lib/services'

/** Everything needed to apply on the employer's site (C10-3). Nothing is submitted from here (V5). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const kit = await services().applyKit.kit(id, user.id)
    if (!kit) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    return NextResponse.json(kit)
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
