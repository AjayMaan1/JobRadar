import type { FetchGateway } from '../gateway/index.js'
import { stripHtml, type BoardEngine, type BoardItem, type BoardRef, type ListResult } from './types.js'

interface GhQuestion {
  label: string
  required?: boolean
  description?: string | null
  fields?: Array<{ name?: string; type?: string; values?: Array<{ label: string; value: unknown }> }>
}

export interface ApplicationQuestion {
  label: string
  required: boolean
  type: string            // input_text | textarea | multi_value_single_select | input_file | …
  name: string | null
  options: string[] | null
  description: string | null
}

interface GhJob {
  id: number
  title: string
  absolute_url: string
  updated_at?: string
  first_published?: string
  location?: { name?: string }
  departments?: Array<{ name: string }>
  offices?: Array<{ name: string; location?: string }>
  metadata?: Array<{ name: string; value: unknown }>
  content?: string
}

export class GreenhouseEngine implements BoardEngine {
  readonly ats = 'greenhouse' as const

  async list(board: BoardRef, gw: FetchGateway, purpose: 'list' | 'probe' = 'list'): Promise<ListResult> {
    const { res, data } = await gw.json<{ jobs: GhJob[] }>({
      url: board.apiUrl, // list without content=true: small payload; detail fetched per new posting
      purpose,
      boardId: board.id,
      etag: board.etag,
      lastModified: board.lastModified,
      bodyHash: board.bodyHash,
    })
    if (!data) return { res, items: null }
    const items: BoardItem[] = (data.jobs ?? []).map((j) => ({
      externalId: String(j.id),
      title: j.title,
      url: j.absolute_url,
      applyUrl: j.absolute_url,
      location: j.location?.name ?? null,
      postedAt: j.first_published ?? null,
      updatedAt: j.updated_at ?? null,
      department: j.departments?.[0]?.name ?? null,
      tags: [...(j.departments?.map((d) => d.name) ?? []), ...(j.offices?.map((o) => o.name) ?? [])],
      hashFields: { title: j.title, location: j.location?.name, updated: j.updated_at },
    }))
    return { res, items }
  }

  /**
   * Public application questions for a posting (Apply Kit, backlog C10-1). Greenhouse exposes them on the
   * same job endpoint with `questions=true`; nothing is submitted here.
   */
  async questions(board: BoardRef, item: Pick<BoardItem, 'externalId'>, gw: FetchGateway): Promise<ApplicationQuestion[] | null> {
    const url = `${board.apiUrl.replace(/\/jobs.*$/, '')}/jobs/${item.externalId}?questions=true`
    const { data } = await gw.json<{ questions?: GhQuestion[]; compliance?: Array<{ questions?: GhQuestion[] }> }>({ url, purpose: 'detail', boardId: board.id || null })
    if (!data) return null
    const all = [...(data.questions ?? []), ...(data.compliance ?? []).flatMap((c) => c.questions ?? [])]
    return all.map((q) => {
      const field = q.fields?.[0]
      return {
        label: q.label,
        required: Boolean(q.required),
        type: field?.type ?? 'input_text',
        name: field?.name ?? null,
        options: field?.values?.map((v) => v.label) ?? null,
        description: q.description ?? null,
      }
    })
  }

  async detail(board: BoardRef, item: BoardItem, gw: FetchGateway) {
    const url = `${board.apiUrl.replace(/\/jobs.*$/, '')}/jobs/${item.externalId}?questions=false`
    const { data } = await gw.json<GhJob & { metadata?: Array<{ name: string; value: unknown }> }>({ url, purpose: 'detail', boardId: board.id })
    if (!data) return null
    const salaryMeta = data.metadata?.find((m) => /salary|compensation|pay/i.test(m.name))
    return {
      description: stripHtml(data.content ?? ''),
      salaryHint: salaryMeta && typeof salaryMeta.value === 'string' ? salaryMeta.value : null,
    }
  }
}
