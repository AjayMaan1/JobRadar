import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { log } from '@jobradar/log'
import { authErrorResponse, hashPassword, MIN_PASSWORD_LENGTH, requireUser, SESSION_COOKIE, tokenHash, verifyPassword } from '../../../../lib/auth'
import { limitUser } from '../../../../lib/rate-limit'

/** Change password (audit NEW-07): re-authenticates, rehashes, and signs out every *other* session. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'auth'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { current?: string; next?: string }
    if (!body.next || body.next.length < MIN_PASSWORD_LENGTH || body.next.length > 200) return NextResponse.json({ error: `New password must be ${MIN_PASSWORD_LENGTH}–200 characters` }, { status: 400 })
    if (user.passwordHash && !verifyPassword(body.current ?? '', user.passwordHash)) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })
    const current = req.cookies.get(SESSION_COOKIE)?.value
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(body.next) } }),
      prisma.session.deleteMany({ where: { userId: user.id, ...(current ? { tokenHash: { not: tokenHash(current) } } : {}) } }),
    ])
    log.info('password changed', { userId: user.id })
    return NextResponse.json({ ok: true, otherSessionsRevoked: true })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
