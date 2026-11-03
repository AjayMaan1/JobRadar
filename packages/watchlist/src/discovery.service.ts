import type { PrismaClient } from '@jobradar/db'
import type { DiscoveryCandidate } from '@jobradar/crawler'
import { log } from '@jobradar/log'

/** Persists discovery candidates idempotently (unique on source + external_ref). */
export class DiscoveryService {
  constructor(private prisma: PrismaClient) {}

  async record(c: DiscoveryCandidate): Promise<{ id: string; created: boolean }> {
    const existing = await this.prisma.companyDiscovery.findUnique({ where: { source_externalRef: { source: c.source, externalRef: c.externalRef } } })
    if (existing) {
      await this.prisma.companyDiscovery.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          seenCount: { increment: 1 },
          ...(c.careersUrlAsSeen && !existing.careersUrlAsSeen ? { careersUrlAsSeen: c.careersUrlAsSeen } : {}),
          ...(c.atsHint && !existing.atsHint ? { atsHint: c.atsHint, slugHint: c.slugHint ?? null, resolution: 'pending' } : {}),
        },
      })
      return { id: existing.id, created: false }
    }
    const row = await this.prisma.companyDiscovery.create({
      data: {
        source: c.source,
        externalRef: c.externalRef,
        nameAsSeen: c.nameAsSeen ?? null,
        domainAsSeen: c.domainAsSeen ?? null,
        careersUrlAsSeen: c.careersUrlAsSeen ?? null,
        atsHint: c.atsHint ?? null,
        slugHint: c.slugHint ?? null,
        payload: {
          ...(c.payload ?? {}),
          ...(c.hqCountryHint ? { hqCountryHint: c.hqCountryHint } : {}),
          ...(c.tagsHint?.length ? { tagsHint: c.tagsHint } : {}),
          ...(c.remoteHint !== undefined ? { remoteHint: c.remoteHint } : {}),
        },
      },
    })
    return { id: row.id, created: true }
  }

  async recordMany(cands: DiscoveryCandidate[]): Promise<{ created: number; seen: number }> {
    let created = 0
    for (const c of cands) {
      try {
        const r = await this.record(c)
        if (r.created) created++
      } catch (err) {
        log.warn('[discovery] record failed', c.source, c.externalRef, (err as Error).message)
      }
    }
    return { created, seen: cands.length }
  }
}
