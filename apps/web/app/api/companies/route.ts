import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { requireAdmin, authErrorResponse } from '../../../lib/auth'
import type { Prisma } from '@jobradar/db'
import { log } from '@jobradar/log'

function normalizeCompanyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|pvt|private|technologies|technology|labs|group|holdings|the)\b/g, '').replace(/\s+/g, ' ').trim()
}

export async function GET(req: NextRequest) {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  const status = searchParams.get('status')
  const tier = searchParams.get('tier')
  const anchor = searchParams.get('anchor')
  const cls = searchParams.get('class')
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50', 10) || 50)

  const where: Prisma.CompanyWhereInput = {}
  if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { domain: { contains: q, mode: 'insensitive' } }]
  if (status) where.status = status as Prisma.CompanyWhereInput['status']
  if (tier) where.tier = tier as Prisma.CompanyWhereInput['tier']
  if (anchor === 'true') where.anchor = true
  if (cls) where.bestClass = cls as Prisma.CompanyWhereInput['bestClass']

  try {
    const [rows, total] = await Promise.all([
      prisma.company.findMany({
        where,
        orderBy: [{ anchor: 'desc' }, { tier: 'asc' }, { postingRate30d: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { boards: { select: { id: true, atsType: true, slug: true, status: true, enabled: true, lastPollAt: true, lastSuccessAt: true, nextPollAt: true, lastPostingCount: true, consecutiveFailures: true, lastError: true } } },
      }),
      prisma.company.count({ where }),
    ])
    return NextResponse.json({ data: rows, total, page, limit })
  } catch (err) {
    log.error('GET /api/companies error:', err)
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 })
  }
}

/** Add a company by careers URL — creates a manual discovery; the resolver/prober do the rest. */
export async function POST(req: NextRequest) {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  try {
    const body = (await req.json()) as { name?: string; careersUrl?: string; hqCountry?: string; tags?: string[]; anchor?: boolean }
    if (!body.name || !body.careersUrl) return NextResponse.json({ error: 'name and careersUrl are required' }, { status: 400 })
    let domain: string | null = null
    try { domain = new URL(body.careersUrl).hostname.replace(/^www\./, '') } catch { /* ignore */ }
    const existing = await prisma.company.findFirst({ where: { OR: [{ normalizedName: normalizeCompanyName(body.name) }, ...(domain ? [{ domain }] : [])] } })
    const company = existing
      ? await prisma.company.update({ where: { id: existing.id }, data: { anchor: body.anchor ?? existing.anchor, tags: [...new Set([...(existing.tags ?? []), ...(body.tags ?? [])])], ...(body.anchor ? { manualTier: 'hot' } : {}) } })
      : await prisma.company.create({
          data: {
            name: body.name.trim(),
            normalizedName: normalizeCompanyName(body.name),
            domain,
            hqCountry: body.hqCountry ?? null,
            tags: body.tags ?? [],
            anchor: body.anchor ?? false,
            manualTier: body.anchor ? 'hot' : null,
            discoveredVia: 'manual',
            status: 'discovered',
            qualityScore: body.anchor ? 80 : 60,
          },
        })
    await prisma.companyDiscovery.upsert({
      where: { source_externalRef: { source: 'manual', externalRef: `ui:${body.careersUrl}` } },
      update: { lastSeenAt: new Date(), seenCount: { increment: 1 }, resolution: 'pending', companyId: company.id },
      create: { companyId: company.id, source: 'manual', externalRef: `ui:${body.careersUrl}`, nameAsSeen: body.name, domainAsSeen: domain, careersUrlAsSeen: body.careersUrl, payload: { hqCountryHint: body.hqCountry ?? null, tagsHint: body.tags ?? [] } },
    })
    return NextResponse.json({ queued: true, companyId: company.id })
  } catch (err) {
    log.error('POST /api/companies error:', err)
    return NextResponse.json({ error: 'Failed to add company' }, { status: 500 })
  }
}
