import type { FetchGateway } from '../gateway/index.js'
import type { BoardEngine, BoardItem, BoardRef, ListResult } from './types.js'

interface LeverPosting {
  id: string
  text: string
  hostedUrl: string
  applyUrl?: string
  createdAt?: number
  updatedAt?: number
  categories?: { team?: string; location?: string; department?: string; commitment?: string; allLocations?: string[] }
  workplaceType?: string // 'remote' | 'hybrid' | 'onsite' | 'unspecified'
  descriptionPlain?: string
  description?: string
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string }
}

export class LeverEngine implements BoardEngine {
  readonly ats = 'lever' as const

  async list(board: BoardRef, gw: FetchGateway, purpose: 'list' | 'probe' = 'list'): Promise<ListResult> {
    // Lever always ships full descriptions in the list; ETag + body hash keep unchanged polls cheap.
    const { res, data } = await gw.json<LeverPosting[]>({
      url: board.apiUrl,
      purpose,
      boardId: board.id,
      etag: board.etag,
      lastModified: board.lastModified,
      bodyHash: board.bodyHash,
    })
    if (!data) return { res, items: null }
    if (!Array.isArray(data)) return { res: { ...res, outcome: 'error', error: 'unexpected lever payload' }, items: null }
    const items: BoardItem[] = data.map((p) => {
      const loc = [p.categories?.location, ...(p.categories?.allLocations ?? [])].filter(Boolean).join(' | ') || null
      const sal = p.salaryRange && p.salaryRange.min
        ? `${p.salaryRange.currency ?? ''} ${p.salaryRange.min}-${p.salaryRange.max ?? ''}/${p.salaryRange.interval ?? 'year'}`
        : null
      return {
        externalId: p.id,
        title: p.text,
        url: p.hostedUrl,
        applyUrl: p.applyUrl ?? p.hostedUrl,
        location: loc,
        isRemoteFlag: p.workplaceType ? p.workplaceType.toLowerCase() === 'remote' : null,
        postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
        updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
        department: p.categories?.department ?? null,
        team: p.categories?.team ?? null,
        employmentTypeHint: p.categories?.commitment ?? null,
        description: p.descriptionPlain ?? (p.description ? p.description.replace(/<[^>]+>/g, ' ') : null),
        salaryHint: sal,
        tags: [p.categories?.team, p.categories?.department, p.workplaceType].filter(Boolean) as string[],
        hashFields: { title: p.text, location: loc, updated: p.updatedAt, wp: p.workplaceType },
      }
    })
    return { res, items }
  }
}
