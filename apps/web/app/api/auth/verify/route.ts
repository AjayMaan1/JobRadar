import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { clientIp, consumeToken, createSession, sessionCookie } from '../../../../lib/auth'

/** E-mail verification: consumes the token, marks the address verified and signs the user in. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string }
  const userId = await consumeToken(body.token ?? '', 'email_verify')
  if (!userId) return NextResponse.json({ error: 'This verification link is invalid or has expired' }, { status: 400 })
  const user = await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } })
  const { token, expiresAt } = await createSession(user.id, { userAgent: req.headers.get('user-agent'), ip: await clientIp() })
  const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } })
  res.cookies.set(sessionCookie(token, expiresAt))
  return res
}
