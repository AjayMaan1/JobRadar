import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { log } from '@jobradar/log'
import { accountLocked, bootstrapAdmin, clearLoginFailures, clientIp, createSession, recordLoginFailure, requireVerification, sessionCookie, verifyPassword } from '../../../../lib/auth'
import { LIMITS, rateLimit, tooMany } from '../../../../lib/rate-limit'

export async function POST(req: NextRequest) {
  const ip = (await clientIp()) ?? 'unknown'
  const rl = await rateLimit(`login:${ip}`, LIMITS.auth.limit, LIMITS.auth.windowSec)
  if (!rl.ok) return tooMany(rl.retryAfterSec)
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string }
  const email = body.email?.trim().toLowerCase()
  const password = body.password ?? ''
  if (!email || !password) return NextResponse.json({ error: 'email and password are required' }, { status: 400 })

  // Per-account lockout (audit NEW-07): independent of the IP window, so a distributed guess still stalls.
  const locked = await accountLocked(email)
  if (locked > 0) return NextResponse.json({ error: 'Too many failed attempts — try again later', retryAfterSec: locked }, { status: 429, headers: { 'retry-after': String(locked) } })

  await bootstrapAdmin().catch((err) => log.error('bootstrapAdmin failed', err as Error))
  const user = await prisma.user.findUnique({ where: { email } })
  // constant-ish time: verify against a dummy hash when the user is unknown
  const ok = user ? verifyPassword(password, user.passwordHash) : (verifyPassword(password, DUMMY), false)
  if (!user || !ok) {
    await recordLoginFailure(email)
    log.warn('login failed', { ip, known: Boolean(user) })
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }
  if (requireVerification() && !user.emailVerifiedAt && user.role !== 'admin') {
    return NextResponse.json({ error: 'Please verify your e-mail address first', code: 'email_unverified' }, { status: 403 })
  }
  await clearLoginFailures(email)
  const { token, expiresAt } = await createSession(user.id, { userAgent: req.headers.get('user-agent'), ip })
  const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } })
  res.cookies.set(sessionCookie(token, expiresAt))
  return res
}

const DUMMY = 'scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
