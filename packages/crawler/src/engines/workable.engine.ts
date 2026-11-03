import type { FetchGateway } from '../gateway/index.js'
import { stripHtml, type BoardEngine, type BoardItem, type BoardRef, type ListResult } from './types.js'

interface WorkableJob {
  id?: number
  shortcode: string
  title: string
  remote?: boolean
  location?: { city?: string; country?: string; countryCode?: string; region?: string; workplaceType?: string }
  locations?: Array<{ city?: string; country?: string; countryCode?: string }>
  department?: string
  type?: string
  published?: string
  url?: string
  description?: string
}

export class WorkableEngine implements BoardEngine {
  readonly ats = 'workable' as const

  async list(board: BoardRef, gw: FetchGateway, purpose: 'list' | 'probe' = 'list'): Promise<ListResult> {
    // Workable's public v3 endpoint is a POST with paging (token). Most boards fit in one page (100).
    const items: BoardItem[] = []
    let token: string | undefined
    let lastRes = null as ListResult['res'] | null
    for (let page = 0; page < 5; page++) {
      const { res, data } = await gw.json<{ results: WorkableJob[]; nextPage?: string }>({
        url: board.apiUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [], token }),
        purpose,
        boardId: board.id,
        bodyHash: page === 0 ? board.bodyHash : null,
      })
      lastRes = res
      if (!data) {
        if (page === 0) return { res, items: null }
        break
      }
      for (const j of data.results ?? []) {
        const locs = (j.locations?.length ? j.locations : j.location ? [j.location] : [])
          .map((l) => [l.city, l.country].filter(Boolean).join(', '))
          .filter(Boolean)
        const loc = locs.join(' | ') || null
        items.push({
          externalId: j.shortcode,
          title: j.title,
          url: j.url ?? `https://apply.workable.com/${board.slug}/j/${j.shortcode}/`,
          applyUrl: j.url ?? `https://apply.workable.com/${board.slug}/j/${j.shortcode}/`,
          location: loc,
          isRemoteFlag: j.remote ?? (j.location?.workplaceType === 'remote' ? true : null),
          postedAt: j.published ?? null,
          department: j.department ?? null,
          employmentTypeHint: j.type ?? null,
          description: j.description ? stripHtml(j.description) : null,
          tags: [j.department, j.type].filter(Boolean) as string[],
          hashFields: { title: j.title, location: loc, remote: j.remote },
        })
      }
      token = data.nextPage
      if (!token) break
    }
    return { res: lastRes!, items }
  }

  async detail(board: BoardRef, item: BoardItem, gw: FetchGateway) {
    const url = `https://apply.workable.com/api/v2/accounts/${board.slug}/jobs/${item.externalId}`
    const { data } = await gw.json<{ description?: string; requirements?: string; benefits?: string }>({ url, purpose: 'detail', boardId: board.id })
    if (!data) return null
    return { description: stripHtml([data.description, data.requirements, data.benefits].filter(Boolean).join('\n')) }
  }
}
