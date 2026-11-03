import type { FetchGateway } from '../gateway/index.js'
import { stripHtml, type BoardEngine, type BoardItem, type BoardRef, type ListResult } from './types.js'

interface SrPosting {
  id: string
  name: string
  releasedDate?: string
  location?: { city?: string; region?: string; country?: string; remote?: boolean }
  department?: { label?: string }
  typeOfEmployment?: { label?: string }
  ref?: string
}

export class SmartRecruitersEngine implements BoardEngine {
  readonly ats = 'smartrecruiters' as const

  async list(board: BoardRef, gw: FetchGateway, purpose: 'list' | 'probe' = 'list'): Promise<ListResult> {
    const items: BoardItem[] = []
    let offset = 0
    let lastRes = null as ListResult['res'] | null
    for (let page = 0; page < 10; page++) {
      const url = `${board.apiUrl}${board.apiUrl.includes('?') ? '&' : '?'}offset=${offset}`
      const { res, data } = await gw.json<{ content: SrPosting[]; totalFound?: number }>({
        url,
        purpose,
        boardId: board.id,
        bodyHash: page === 0 ? board.bodyHash : null,
      })
      lastRes = res
      if (!data) {
        if (page === 0) return { res, items: null }
        break
      }
      for (const p of data.content ?? []) {
        const loc = [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(', ') || null
        items.push({
          externalId: p.id,
          title: p.name,
          url: `https://jobs.smartrecruiters.com/${board.slug}/${p.id}`,
          applyUrl: `https://jobs.smartrecruiters.com/${board.slug}/${p.id}`,
          location: p.location?.remote ? `${loc ?? ''} (Remote)`.trim() : loc,
          isRemoteFlag: p.location?.remote ?? null,
          postedAt: p.releasedDate ?? null,
          department: p.department?.label ?? null,
          employmentTypeHint: p.typeOfEmployment?.label ?? null,
          tags: [p.department?.label, p.typeOfEmployment?.label].filter(Boolean) as string[],
          hashFields: { title: p.name, location: loc, remote: p.location?.remote },
        })
      }
      const total = data.totalFound ?? 0
      offset += (data.content ?? []).length
      if (!data.content?.length || offset >= total) break
    }
    return { res: lastRes!, items }
  }

  async detail(board: BoardRef, item: BoardItem, gw: FetchGateway) {
    const url = `https://api.smartrecruiters.com/v1/companies/${board.slug}/postings/${item.externalId}`
    const { data } = await gw.json<{ jobAd?: { sections?: Record<string, { text?: string }> } }>({ url, purpose: 'detail', boardId: board.id })
    if (!data?.jobAd?.sections) return null
    const text = Object.values(data.jobAd.sections).map((s) => s?.text ?? '').join('\n')
    return { description: stripHtml(text) }
  }
}
