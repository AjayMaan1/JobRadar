import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../../lib/auth'
import { services } from '../../../../../lib/services'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const ok = await services().preferences.deletePreset(user.id, id)
    if (!ok) return NextResponse.json({ error: 'Not found (system presets cannot be deleted)' }, { status: 404 })
    return NextResponse.json({ deleted: true })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
