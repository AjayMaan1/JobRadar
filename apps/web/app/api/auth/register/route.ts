import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { log } from '@jobradar/log'
import { sendAuthEmail } from '@jobradar/notifications'
import { appUrl, clientIp, createSession, hashPassword, issueToken, MIN_PASSWORD_LENGTH, requireVerification, sessionCookie } from '../../../../lib/auth'
import { rateLimit, tooMany } from '../../../../lib/rate-limit'

/**
 * Self sign-up, only when ALLOW_SIGNUP=true (multi-user decision — HLD open item 1). With
 * SIGNUP_REQUIRE_VERIFICATION=true a verification link is e-mailed and no session is issued until it is used.
 */
export async function POST(req: NextRequest) {
  if (process.env.ALLOW_SIGNUP !== 'true') return NextResponse.json({ error: 'Sign-up is disabled' }, { status: 403 })
  const ip = (await clientIp()) ?? 'unknown'
  const rl = await rateLimit(`register:${ip}`, 5, 60 * 60)
  if (!rl.ok) return tooMany(rl.retryAfterSec)
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string; name?: string }
  const email = body.email?.trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  if (!body.password || body.password.length < MIN_PASSWORD_LENGTH || body.password.length > 200) return NextResponse.json({ error: `Password must be ${MIN_PASSWORD_LENGTH}–200 characters` }, { status: 400 })
  if (await prisma.user.findUnique({ where: { email } })) return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
  const verify = requireVerification()
  const user = await prisma.user.create({ data: { email, name: body.name?.trim().slice(0, 80) ?? null, passwordHash: hashPassword(body.password), emailVerifiedAt: verify ? null : new Date() } })
  if (verify) {
    const token = await issueToken(user.id, 'email_verify', 24 * 60)
    await sendAuthEmail(email, 'verify', `${appUrl()}/login?verify=${encodeURIComponent(token)}`).catch((err) => log.error('verification e-mail failed', err as Error))
    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, verificationRequired: true }, { status: 201 })
  }
  const { token, expiresAt } = await createSession(user.id, { userAgent: req.headers.get('user-agent'), ip })
  const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }, { status: 201 })
  res.cookies.set(sessionCookie(token, expiresAt))
  return res
}
