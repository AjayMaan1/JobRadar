import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { authErrorResponse, requireUser, SESSION_COOKIE, tokenHash } from '../../../../lib/auth'

/** Active sessions for the signed-in user (audit NEW-07). The current one is flagged. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const current = req.cookies.get(SESSION_COOKIE)?.value
    const currentHash = current ? tokenHash(current) : null
    const rows = await prisma.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: 'desc' }, select: { id: true, tokenHash: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true, expiresAt: true } })
    return NextResponse.json({ data: rows.map(({ tokenHash: h, ...r }) => ({ ...r, current: h === currentHash })) })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/** Sign out everywhere except here. */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser()
    const current = req.cookies.get(SESSION_COOKIE)?.value
    const r = await prisma.session.deleteMany({ where: { userId: user.id, ...(current ? { tokenHash: { not: tokenHash(current) } } : {}) } })
    return NextResponse.json({ revoked: r.count })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
