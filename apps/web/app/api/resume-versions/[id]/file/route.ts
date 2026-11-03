import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../../lib/auth'
import { services } from '../../../../../lib/services'

/** ?fmt=pdf|docx → 302 to a short-lived signed URL (C9-5). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const fmt = new URL(req.url).searchParams.get('fmt') === 'docx' ? 'docx' : 'pdf'
    const url = await services().versions.fileUrl(id, user.id, fmt)
    if (!url) return NextResponse.json({ error: 'File not rendered yet' }, { status: 404 })
    return NextResponse.redirect(new URL(url, req.url), 302)
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
