import type { FetchGateway } from '../gateway/index.js'
import { stripHtml, type BoardEngine, type BoardItem, type BoardRef, type ListResult } from './types.js'

interface WdPosting {
  title: string
  externalPath: string
  locationsText?: string
  postedOn?: string
  bulletFields?: string[]
}

/**
 * Workday — SCOPED MODE ONLY. Requires board.queryScope.searchText (e.g. "Gurgaon") so we
 * never pull a full enterprise board. Refuses to run unscoped.
 */
export class WorkdayEngine implements BoardEngine {
  readonly ats = 'workday' as const

  async list(board: BoardRef, gw: FetchGateway, purpose: 'list' | 'probe' = 'list'): Promise<ListResult> {
    const scope = (board.queryScope ?? {}) as { searchText?: string; appliedFacets?: Record<string, string[]> }
    if (!scope.searchText && !scope.appliedFacets) {
      return {
        res: { outcome: 'skipped', status: null, body: null, etag: null, lastModified: null, bodyHash: null, durationMs: 0, bytes: 0, host: new URL(board.apiUrl).hostname, error: 'workday board has no queryScope; refusing unscoped poll' },
        items: null,
      }
    }
    const [host, site] = board.slug.split('/')
    const base = `https://${host}/${site}`
    const items: BoardItem[] = []
    let offset = 0
    let lastRes = null as ListResult['res'] | null
    for (let page = 0; page < 5; page++) {
      const { res, data } = await gw.json<{ jobPostings?: WdPosting[]; total?: number }>({
        url: board.apiUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ appliedFacets: scope.appliedFacets ?? {}, limit: 20, offset, searchText: scope.searchText ?? '' }),
        purpose,
        boardId: board.id,
        bodyHash: page === 0 ? board.bodyHash : null,
        timeoutMs: 30000,
      })
      lastRes = res
      if (!data) {
        if (page === 0) return { res, items: null }
        break
      }
      for (const p of data.jobPostings ?? []) {
        const url = `${base}${p.externalPath}`
        items.push({
          externalId: p.externalPath,
          title: p.title,
          url,
          applyUrl: url,
          location: p.locationsText ?? null,
          postedAt: null, // "Posted 3 Days Ago" — relative; resolved from first_seen
          tags: p.bulletFields ?? [],
          hashFields: { title: p.title, location: p.locationsText },
        })
      }
      offset += 20
      if ((data.jobPostings ?? []).length < 20 || offset >= (data.total ?? 0)) break
    }
    return { res: lastRes!, items }
  }

  async detail(board: BoardRef, item: BoardItem, gw: FetchGateway) {
    const [host, site] = board.slug.split('/')
    const tenant = host.split('.')[0]
    const url = `https://${host}/wday/cxs/${tenant}/${site}${item.externalId}`
    const { data } = await gw.json<{ jobPostingInfo?: { jobDescription?: string; timeType?: string; startDate?: string } }>({
      url,
      headers: { Accept: 'application/json' },
      purpose: 'detail',
      boardId: board.id,
      timeoutMs: 30000,
    })
    if (!data?.jobPostingInfo) return null
    return {
      description: stripHtml(data.jobPostingInfo.jobDescription ?? ''),
      employmentTypeHint: data.jobPostingInfo.timeType ?? null,
    }
  }
}
