import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import type { Prisma } from '@jobradar/db'
import { canonicalizeSkill } from '@jobradar/resume'
import { requireUser, unauthorized, Unauthorized } from '../../../lib/auth'
import { services, queueErrorResponse } from '../../../lib/services'
import { log } from '@jobradar/log'

export async function GET() {
  try {
    const user = await requireUser()
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: user.id } })
    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, profile })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    if (err instanceof Unauthorized) return unauthorized()
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/** Master headline/about/skills/targets are user-owned: this is the only place they change (HLD V1). */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser()
    const body = (await req.json()) as { headline?: string | null; about?: string | null; targetTitles?: string[]; skills?: Array<{ name: string }>; yearsExperience?: number | null; payFloorInr?: number | null; applyDefaults?: Record<string, string | null | undefined> }
    const data: Prisma.CandidateProfileUncheckedUpdateInput = {}
    if (body.headline !== undefined) data.headline = body.headline?.trim().slice(0, 160) || null
    if (body.about !== undefined) data.about = body.about?.trim().slice(0, 2000) || null
    if (Array.isArray(body.targetTitles)) data.targetTitles = body.targetTitles.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
    if (Array.isArray(body.skills)) {
      const seen = new Set<string>()
      const skills: Array<{ name: string; canonical: string; confirmed: boolean; source: string }> = []
      for (const s of body.skills) {
        const name = String(s?.name ?? '').trim().slice(0, 40)
        if (!name) continue
        const canonical = canonicalizeSkill(name)
        if (seen.has(canonical.toLowerCase())) continue
        seen.add(canonical.toLowerCase())
        skills.push({ name, canonical, confirmed: true, source: 'user' })
      }
      data.skills = skills as unknown as Prisma.InputJsonValue
    }
    if (body.yearsExperience !== undefined) data.yearsExperience = body.yearsExperience === null ? null : Math.max(0, Math.min(50, Number(body.yearsExperience)))
    if (body.applyDefaults && typeof body.applyDefaults === 'object') {
      const allowed = ['noticePeriod', 'currentLocation', 'workAuthorization', 'salaryExpectation', 'linkedin', 'portfolio']
      const defaults: Record<string, string> = {}
      for (const k of allowed) { const v = body.applyDefaults[k]; if (typeof v === 'string' && v.trim()) defaults[k] = v.trim().slice(0, 300) }
      data.applyDefaults = defaults as unknown as Prisma.InputJsonValue
    }
    if (body.payFloorInr !== undefined) data.payFloorInr = body.payFloorInr === null ? null : Math.max(0, Number(body.payFloorInr))
    const profile = await prisma.candidateProfile.upsert({ where: { userId: user.id }, create: { ...(data as Omit<Prisma.CandidateProfileUncheckedCreateInput, 'userId'>), userId: user.id }, update: data })
    // C13: profile text changed → re-embed + recompute fits (worker)
    await services().queues.embed.add('profile', { type: 'profile', userId: user.id }, { jobId: `embed:profile:${user.id}:${Date.now()}`, removeOnComplete: 20, removeOnFail: 20 }).catch(() => undefined)
    return NextResponse.json({ profile })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    if (err instanceof Unauthorized) return unauthorized()
    log.error('PATCH /api/profile error:', err)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
