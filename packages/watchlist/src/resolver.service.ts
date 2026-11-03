import type { Prisma, PrismaClient, CompanyDiscovery, AtsType } from '@jobradar/db'
import { detectAts, apiUrlFor, hostFor, costClassFor, careersUrlFor, supportedAts, type FetchGateway, type KnownAts, type AtsRef } from '@jobradar/crawler'
import { CompanyService } from './company.service.js'
import { log } from '@jobradar/log'

const AGENCY_RE = /\b(recruit|staffing|talent|consultanc|headhunt|placement|manpower|outsourc)/i

/**
 * Turns discoveries into companies + verified boards.
 *  - slug hint present → board created directly (probe verifies before polling)
 *  - careers URL → detectAts() (1 budgeted HTML fetch) → boards
 *  - nothing usable → 'no_ats' (re-tried monthly by the discovery sweep)
 */
export class ResolverService {
  private companies: CompanyService

  constructor(private prisma: PrismaClient, private gateway: FetchGateway) {
    this.companies = new CompanyService(prisma)
  }

  async resolvePending(limit = 100): Promise<{ resolved: number; noAts: number; rejected: number }> {
    const rows = await this.prisma.companyDiscovery.findMany({
      where: { resolution: 'pending' },
      orderBy: [{ seenCount: 'desc' }, { firstSeenAt: 'asc' }],
      take: limit,
    })
    let resolved = 0, noAts = 0, rejected = 0
    for (const d of rows) {
      try {
        const r = await this.resolveOne(d)
        if (r === 'resolved') resolved++
        else if (r === 'no_ats') noAts++
        else rejected++
      } catch (err) {
        log.warn('[resolver] failed', d.source, d.externalRef, (err as Error).message)
        await this.prisma.companyDiscovery.update({ where: { id: d.id }, data: { resolutionNote: String((err as Error).message).slice(0, 300) } })
      }
    }
    return { resolved, noAts, rejected }
  }

  async resolveOne(d: CompanyDiscovery): Promise<'resolved' | 'no_ats' | 'rejected'> {
    const payload = (d.payload ?? {}) as Record<string, unknown>
    const name = (d.nameAsSeen ?? '').trim()
    if (!name || name.length < 2) return this.mark(d, 'rejected', 'no name')
    if (AGENCY_RE.test(name)) return this.mark(d, 'rejected', 'looks like a staffing agency')

    const hq = typeof payload.hqCountryHint === 'string' ? payload.hqCountryHint : null
    const tags = Array.isArray(payload.tagsHint) ? (payload.tagsHint as string[]) : []
    let companyId = d.companyId
    if (!companyId) {
      const { company } = await this.companies.findOrCreate({ name, domain: d.domainAsSeen, hqCountry: hq, tags, discoveredVia: d.source })
      companyId = company.id
    }

    const refs: AtsRef[] = []
    if (d.atsHint && d.slugHint) {
      refs.push({ ats: d.atsHint as KnownAts, slug: d.slugHint, host: hostFor(d.atsHint as KnownAts, d.slugHint), careersUrl: careersUrlFor(d.atsHint as KnownAts, d.slugHint) })
    } else if (d.careersUrlAsSeen) {
      refs.push(...(await detectAts(d.careersUrlAsSeen, this.gateway)))
    }

    const usable = refs.filter((r) => supportedAts().includes(r.ats))
    if (usable.length === 0) {
      await this.prisma.company.updateMany({ where: { id: companyId, status: { in: ['discovered', 'resolving'] } }, data: { status: 'unresolved', statusReason: 'no pollable ATS found' } })
      return this.mark(d, 'no_ats', refs.length ? `unsupported ats: ${refs.map((r) => r.ats).join(',')}` : 'no ats reference', companyId)
    }

    for (const ref of usable) {
      const queryScope = ref.ats === 'workday' ? ((payload.queryScope as Prisma.InputJsonObject | undefined) ?? null) : null
      if (ref.ats === 'workday' && !queryScope) continue // never create unscoped workday boards
      await this.prisma.companyBoard.upsert({
        where: { atsType_slug: { atsType: ref.ats as AtsType, slug: ref.slug } },
        update: { companyId, careersUrl: ref.careersUrl, ...(queryScope ? { queryScope } : {}) },
        create: {
          companyId,
          atsType: ref.ats as AtsType,
          slug: ref.slug,
          host: ref.host,
          apiUrl: apiUrlFor(ref.ats, ref.slug),
          careersUrl: ref.careersUrl,
          costClass: costClassFor(ref.ats),
          queryScope: queryScope ?? undefined,
          status: 'active',
          enabled: true,
          nextPollAt: new Date(), // probed immediately (probe budget permitting)
        },
      })
    }
    await this.prisma.company.update({ where: { id: companyId }, data: { status: 'probing', statusReason: null } })
    return this.mark(d, 'resolved', `${usable.map((r) => `${r.ats}:${r.slug}`).join(', ')}`, companyId)
  }

  private async mark(d: CompanyDiscovery, resolution: 'resolved' | 'no_ats' | 'rejected', note: string, companyId?: string | null) {
    await this.prisma.companyDiscovery.update({
      where: { id: d.id },
      data: { resolution, resolvedAt: new Date(), resolutionNote: note.slice(0, 300), ...(companyId ? { companyId } : {}) },
    })
    return resolution
  }
}
