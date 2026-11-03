import { NextRequest, NextResponse } from 'next/server'
import { requireUser, unauthorized, Unauthorized } from '../../../../lib/auth'
import { services } from '../../../../lib/services'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const t = await services().tasks.get(id)
    if (t && t.userId && t.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!t) {
      // Audit NEW-13: a well-formed id we no longer know = state expired or the process restarted (inline mode).
      // Tell the UI so it stops polling instead of spinning forever.
      if (UUID.test(id)) return NextResponse.json({ id, status: 'failed', error: 'task_lost', progress: null, result: null, type: 'unknown', userId: user.id, createdAt: null, updatedAt: new Date().toISOString() }, { status: 200 })
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(t)
  } catch (err) {
    if (err instanceof Unauthorized) return unauthorized()
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
