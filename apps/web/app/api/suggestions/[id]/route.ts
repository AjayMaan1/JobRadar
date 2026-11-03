import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../lib/auth'
import { services } from '../../../../lib/services'

/** { status: accepted|rejected|edited|pending, userEdit? } — user discretion on every change (V1). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const body = (await req.json().catch(() => ({}))) as { status?: string; userEdit?: string | null }
    if (!['accepted', 'rejected', 'edited', 'pending'].includes(String(body.status))) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    const s = await services().suggestions.setStatus(id, user.id, body.status as 'accepted', body.userEdit)
    return NextResponse.json(s)
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
