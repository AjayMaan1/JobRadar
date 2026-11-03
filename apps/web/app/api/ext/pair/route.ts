import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { log } from '@jobradar/log'
import { authErrorResponse, issueToken, requireUser, tokenHash } from '../../../../lib/auth'
import { limitUser } from '../../../../lib/rate-limit'

const TOKEN_DAYS = parseInt(process.env.EXTENSION_TOKEN_DAYS ?? '180', 10)

/**
 * Pairing (cookie session — done from the web UI, never from the extension):
 *   POST   → { token, expiresAt }  — shown once; the extension stores it
 *   GET    → active extension tokens (id, created, expires) for the revoke list
 *   DELETE → { id } revoke one, or {} revoke all
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'auth'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { label?: string }
    const token = await issueTokenKeepingOthers(user.id)
    const row = await prisma.authToken.findUnique({ where: { tokenHash: tokenHash(token) } })
    log.info('extension token issued', { userId: user.id, label: body.label?.slice(0, 40) })
    return NextResponse.json({ token, expiresAt: row?.expiresAt ?? null, baseUrl: (process.env.APP_URL ?? req.nextUrl.origin).replace(/\/$/, '') }, { status: 201 })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/** Unlike reset/verify tokens, several extension tokens (one per browser) may be live at once. */
async function issueTokenKeepingOthers(userId: string): Promise<string> {
  const { randomBytes } = await import('node:crypto')
  const live = await prisma.authToken.count({ where: { userId, kind: 'extension', usedAt: null, expiresAt: { gt: new Date() } } })
  if (live >= 5) throw new Error('At most 5 paired browsers — revoke one first')
  const token = randomBytes(32).toString('base64url')
  await prisma.authToken.create({ data: { userId, kind: 'extension', tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + TOKEN_DAYS * 86400_000) } })
  return token
}

export async function GET() {
  try {
    const user = await requireUser()
    const rows = await prisma.authToken.findMany({ where: { userId: user.id, kind: 'extension', usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true, expiresAt: true } })
    return NextResponse.json({ data: rows })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser()
    const body = (await req.json().catch(() => ({}))) as { id?: string }
    const r = await prisma.authToken.updateMany({ where: { userId: user.id, kind: 'extension', usedAt: null, ...(body.id ? { id: body.id } : {}) }, data: { usedAt: new Date() } })
    return NextResponse.json({ revoked: r.count })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
// keep the generic helper import referenced for tree-shaking clarity
void issueToken
