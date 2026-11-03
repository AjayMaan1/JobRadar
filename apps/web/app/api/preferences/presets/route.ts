import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../lib/auth'
import { limitUser } from '../../../../lib/rate-limit'
import { services } from '../../../../lib/services'

/** System presets (read-only) + the caller's private presets. POST saves the given doc as a private preset. */
export async function GET() {
  try {
    const user = await requireUser()
    const { preferences } = services()
    await preferences.ensureSystemPresets()
    return NextResponse.json({ data: await preferences.presets(user.id) })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'mutate'); if (rl) return rl
    const body = (await req.json().catch(() => null)) as { name?: string; description?: string; doc?: unknown } | null
    if (!body?.name || !body.doc) return NextResponse.json({ error: 'Body must be { name, doc, description? }' }, { status: 400 })
    try {
      const row = await services().preferences.savePreset(user.id, body.name, body.doc, body.description)
      return NextResponse.json({ id: row.id, name: row.name }, { status: 201 })
    } catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 400 }) }
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
