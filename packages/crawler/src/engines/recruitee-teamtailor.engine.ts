import type { FetchGateway } from '../gateway/index.js'
import { stripHtml, type BoardEngine, type BoardItem, type BoardRef, type ListResult } from './types.js'

interface RecruiteeOffer {
  id: number
  title: string
  careers_url: string
  careers_apply_url?: string
  location?: string
  remote?: boolean
  department?: string
  employment_type_code?: string
  published_at?: string
  description?: string
  requirements?: string
}

export class RecruiteeEngine implements BoardEngine {
  readonly ats = 'recruitee' as const

  async list(board: BoardRef, gw: FetchGateway, purpose: 'list' | 'probe' = 'list'): Promise<ListResult> {
    const { res, data } = await gw.json<{ offers: RecruiteeOffer[] }>({
      url: board.apiUrl,
      purpose,
      boardId: board.id,
      etag: board.etag,
      bodyHash: board.bodyHash,
    })
    if (!data) return { res, items: null }
    const items: BoardItem[] = (data.offers ?? []).map((o) => ({
      externalId: String(o.id),
      title: o.title,
      url: o.careers_url,
      applyUrl: o.careers_apply_url ?? o.careers_url,
      location: o.location ?? null,
      isRemoteFlag: o.remote ?? null,
      postedAt: o.published_at ?? null,
      department: o.department ?? null,
      employmentTypeHint: o.employment_type_code ?? null,
      description: stripHtml([o.description, o.requirements].filter(Boolean).join('\n')) || null,
      tags: [o.department].filter(Boolean) as string[],
      hashFields: { title: o.title, location: o.location, remote: o.remote },
    }))
    return { res, items }
  }
}

interface TeamtailorJob {
  id: string
  attributes?: { title: string; 'remote-status'?: string; 'created-at'?: string; body?: string; 'employment-type'?: string }
  links?: { 'careersite-job-url'?: string; 'careersite-job-apply-url'?: string }
}

export class TeamtailorEngine implements BoardEngine {
  readonly ats = 'teamtailor' as const

  async list(board: BoardRef, gw: FetchGateway, purpose: 'list' | 'probe' = 'list'): Promise<ListResult> {
    const { res, data } = await gw.json<{ data: TeamtailorJob[] }>({
      url: board.apiUrl,
      purpose,
      boardId: board.id,
      etag: board.etag,
      bodyHash: board.bodyHash,
    })
    if (!data) return { res, items: null }
    const items: BoardItem[] = (data.data ?? []).map((j) => ({
      externalId: j.id,
      title: j.attributes?.title ?? '',
      url: j.links?.['careersite-job-url'] ?? `https://${board.slug}.teamtailor.com/jobs/${j.id}`,
      applyUrl: j.links?.['careersite-job-apply-url'] ?? null,
      location: null,
      isRemoteFlag: j.attributes?.['remote-status'] ? /fully|remote/i.test(j.attributes['remote-status']) : null,
      postedAt: j.attributes?.['created-at'] ?? null,
      employmentTypeHint: j.attributes?.['employment-type'] ?? null,
      description: j.attributes?.body ? stripHtml(j.attributes.body) : null,
      tags: [],
      hashFields: { title: j.attributes?.title, remote: j.attributes?.['remote-status'] },
    }))
    return { res, items }
  }
}
