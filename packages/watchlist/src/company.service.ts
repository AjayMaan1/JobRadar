import type { PrismaClient, Company } from '@jobradar/db'

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|pvt|private|technologies|technology|labs|group|holdings|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export class CompanyService {
  constructor(private prisma: PrismaClient) {}

  async findByNameOrDomain(name: string | null | undefined, domain: string | null | undefined): Promise<Company | null> {
    const PLACEHOLDER = new Set(['unknown', 'unknown company', 'arc client', 'yc startup', 'confidential', 'stealth'])
    if (name && PLACEHOLDER.has(name.trim().toLowerCase())) name = null
    if (domain) {
      const byDomain = await this.prisma.company.findUnique({ where: { domain } })
      if (byDomain) return byDomain
    }
    if (name) {
      const norm = normalizeCompanyName(name)
      if (norm.length >= 3) {
        const byName = await this.prisma.company.findFirst({ where: { normalizedName: norm } })
        if (byName) return byName
      }
    }
    return null
  }

  async findOrCreate(input: {
    name: string
    domain?: string | null
    hqCountry?: string | null
    tags?: string[]
    discoveredVia: Company['discoveredVia']
  }): Promise<{ company: Company; created: boolean }> {
    const existing = await this.findByNameOrDomain(input.name, input.domain)
    if (existing) {
      const mergedTags = [...new Set([...(existing.tags ?? []), ...(input.tags ?? [])])]
      const patch: Record<string, unknown> = {}
      if (mergedTags.length !== (existing.tags ?? []).length) patch.tags = mergedTags
      if (!existing.domain && input.domain) patch.domain = input.domain
      if (!existing.hqCountry && input.hqCountry) patch.hqCountry = input.hqCountry
      const company = Object.keys(patch).length ? await this.prisma.company.update({ where: { id: existing.id }, data: patch }) : existing
      return { company, created: false }
    }
    try {
      const company = await this.prisma.company.create({
        data: {
          name: input.name.trim(),
          normalizedName: normalizeCompanyName(input.name),
          domain: input.domain ?? null,
          hqCountry: input.hqCountry ?? null,
          tags: input.tags ?? [],
          discoveredVia: input.discoveredVia,
          status: 'discovered',
          qualityScore: 60,
        },
      })
      return { company, created: true }
    } catch (err) {
      // domain unique race — re-read
      const again = await this.findByNameOrDomain(input.name, input.domain)
      if (again) return { company: again, created: false }
      throw err
    }
  }
}
