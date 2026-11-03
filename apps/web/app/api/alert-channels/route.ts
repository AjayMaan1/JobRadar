import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { emailConfigured, telegramConfigured } from '@jobradar/notifications'
import { authErrorResponse, requireUser } from '../../../lib/auth'
import { limitUser } from '../../../lib/rate-limit'

const CLASSES = new Set(['p1_global_remote', 'p2_india_remote', 'p3_ncr_hybrid'])

/** Per-user alert delivery (GH-6 / audit NEW-03). When no rows exist the env channel is used (owner only). */
export async function GET() {
  try {
    const user = await requireUser()
    const data = await prisma.alertChannel.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } })
    return NextResponse.json({ data, providers: { telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN), email: emailConfigured() }, envFallback: data.length === 0 && (telegramConfigured() || Boolean(process.env.EMAIL_TO)) && user.role === 'admin' })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'mutate'); if (rl) return rl
    const body = (await req.json().catch(() => ({}))) as { kind?: string; address?: string; classes?: string[]; minScore?: number; instant?: boolean; digest?: boolean; enabled?: boolean }
    const kind = body.kind === 'email' ? 'email' : body.kind === 'telegram' ? 'telegram' : null
    if (!kind) return NextResponse.json({ error: 'kind must be telegram | email' }, { status: 400 })
    const address = String(body.address ?? '').trim()
    if (kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return NextResponse.json({ error: 'Valid e-mail required' }, { status: 400 })
    if (kind === 'telegram' && !/^-?\d{3,20}$/.test(address)) return NextResponse.json({ error: 'Telegram chat id must be numeric (send /start to the bot, then read the chat id)' }, { status: 400 })
    const classes = Array.isArray(body.classes) ? body.classes.filter((c) => CLASSES.has(String(c))).map(String) : undefined
    const count = await prisma.alertChannel.count({ where: { userId: user.id } })
    if (count >= 5) return NextResponse.json({ error: 'At most 5 channels' }, { status: 400 })
    const row = await prisma.alertChannel.upsert({
      where: { userId_kind_address: { userId: user.id, kind, address } },
      create: { userId: user.id, kind, address, ...(classes ? { classes } : {}), minScore: clamp(body.minScore), instant: body.instant ?? true, digest: body.digest ?? true, enabled: body.enabled ?? true },
      update: { ...(classes ? { classes } : {}), ...(body.minScore !== undefined ? { minScore: clamp(body.minScore) } : {}), ...(body.instant !== undefined ? { instant: body.instant } : {}), ...(body.digest !== undefined ? { digest: body.digest } : {}), ...(body.enabled !== undefined ? { enabled: body.enabled } : {}) },
    })
    return NextResponse.json(row, { status: 201 })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

function clamp(n: unknown): number { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0 }
