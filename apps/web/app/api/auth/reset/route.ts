import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { log } from '@jobradar/log'
import { clientIp, consumeToken, hashPassword, MIN_PASSWORD_LENGTH } from '../../../../lib/auth'
import { rateLimit, tooMany } from '../../../../lib/rate-limit'

/** Password reset, step 2: single-use token → new password; every session is revoked. */
export async function POST(req: NextRequest) {
  const ip = (await clientIp()) ?? 'unknown'
  const rl = await rateLimit(`reset2:${ip}`, 10, 3600)
  if (!rl.ok) return tooMany(rl.retryAfterSec)
  const body = (await req.json().catch(() => ({}))) as { token?: string; password?: string }
  if (!body.password || body.password.length < MIN_PASSWORD_LENGTH || body.password.length > 200) return NextResponse.json({ error: `Password must be ${MIN_PASSWORD_LENGTH}–200 characters` }, { status: 400 })
  const userId = await consumeToken(body.token ?? '', 'password_reset')
  if (!userId) return NextResponse.json({ error: 'This reset link is invalid or has expired' }, { status: 400 })
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(body.password), emailVerifiedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId } }),
  ])
  log.info('password reset completed', { userId })
  return NextResponse.json({ ok: true })
}
