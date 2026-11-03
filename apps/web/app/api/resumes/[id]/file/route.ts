import { NextRequest, NextResponse } from 'next/server'
import { requireUser, unauthorized, Unauthorized } from '../../../../../lib/auth'
import { services } from '../../../../../lib/services'

/** Redirect to a short-lived signed URL for the original upload. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const url = await services().resumes.originalUrl(id, user.id)
    if (!url) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.redirect(new URL(url, _req.url), 302)
  } catch (err) {
    if (err instanceof Unauthorized) return unauthorized()
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
