import type { FetchGateway } from '../gateway/index.js'
import { stripHtml, type BoardEngine, type BoardItem, type BoardRef, type ListResult } from './types.js'

interface AshbyPosting {
  id: string
  title: string
  jobUrl: string
  applyUrl?: string
  location?: string
  secondaryLocations?: Array<{ location: string }>
  department?: string
  team?: string
  isRemote?: boolean
  employmentType?: string
  publishedAt?: string
  descriptionPlain?: string
  descriptionHtml?: string
  compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string }
}

export class AshbyEngine implements BoardEngine {
  readonly ats = 'ashby' as const

  async list(board: BoardRef, gw: FetchGateway, purpose: 'list' | 'probe' = 'list'): Promise<ListResult> {
    const { res, data } = await gw.json<{ jobs: AshbyPosting[] }>({
      url: board.apiUrl,
      purpose,
      boardId: board.id,
      etag: board.etag,
      lastModified: board.lastModified,
      bodyHash: board.bodyHash,
    })
    if (!data) return { res, items: null }
    const items: BoardItem[] = (data.jobs ?? []).map((p) => {
      const loc = [p.location, ...(p.secondaryLocations?.map((s) => s.location) ?? [])].filter(Boolean).join(' | ') || null
      return {
        externalId: p.id,
        title: p.title,
        url: p.jobUrl,
        applyUrl: p.applyUrl ?? p.jobUrl,
        location: loc,
        isRemoteFlag: p.isRemote ?? null,
        postedAt: p.publishedAt ?? null,
        department: p.department ?? null,
        team: p.team ?? null,
        employmentTypeHint: p.employmentType ?? null,
        description: p.descriptionPlain ?? (p.descriptionHtml ? stripHtml(p.descriptionHtml) : null),
        salaryHint: p.compensation?.scrapeableCompensationSalarySummary ?? p.compensation?.compensationTierSummary ?? null,
        tags: [p.department, p.team, p.employmentType].filter(Boolean) as string[],
        hashFields: { title: p.title, location: loc, remote: p.isRemote, published: p.publishedAt },
      }
    })
    return { res, items }
  }
}
