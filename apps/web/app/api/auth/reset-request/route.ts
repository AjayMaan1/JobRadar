import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { log } from '@jobradar/log'
import { sendAuthEmail } from '@jobradar/notifications'
import { appUrl, clientIp, issueToken } from '../../../../lib/auth'
import { rateLimit, tooMany } from '../../../../lib/rate-limit'

/** Password reset, step 1 (audit NEW-07). Always 200 — never reveals whether the address exists. */
export async function POST(req: NextRequest) {
  const ip = (await clientIp()) ?? 'unknown'
  const rl = await rateLimit(`reset:${ip}`, 5, 3600)
  if (!rl.ok) return tooMany(rl.retryAfterSec)
  const body = (await req.json().catch(() => ({}))) as { email?: string }
  const email = body.email?.trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  const user = await prisma.user.findUnique({ where: { email } })
  if (user) {
    const perUser = await rateLimit(`reset:user:${user.id}`, 3, 3600)
    if (perUser.ok) {
      const token = await issueToken(user.id, 'password_reset', 30)
      await sendAuthEmail(email, 'reset', `${appUrl()}/login?reset=${encodeURIComponent(token)}`).catch((err) => log.error('reset e-mail failed', err as Error))
    }
  }
  return NextResponse.json({ ok: true, message: 'If that address has an account, a reset link has been sent.' })
}
