import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../../lib/auth'
import { services } from '../../../../../lib/services'

/** HTML preview of the version using the same template as the PDF (served sandboxed in an iframe). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const html = await services().versions.previewHtml(id, user.id)
    if (!html) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-frame-options': 'SAMEORIGIN', 'cache-control': 'private, no-store' } })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
