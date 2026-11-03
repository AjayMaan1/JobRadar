import type { FetchGateway, GatewayResponse } from '../gateway/index.js'
import type { KnownAts } from '../ats-urls.js'

/** Minimal board reference the engines need (subset of the CompanyBoard row). */
export interface BoardRef {
  id: string
  atsType: KnownAts | string
  slug: string
  apiUrl: string
  careersUrl?: string | null
  queryScope?: Record<string, unknown> | null
  etag?: string | null
  lastModified?: string | null
  bodyHash?: string | null
  companyName: string
}

/** One posting as it appears in a board's list response (list-level fields only). */
export interface BoardItem {
  externalId: string
  title: string
  url: string
  applyUrl?: string | null
  location: string | null
  isRemoteFlag?: boolean | null
  postedAt?: string | null
  updatedAt?: string | null
  department?: string | null
  team?: string | null
  employmentTypeHint?: string | null
  description?: string | null // only when the list already includes it
  salaryHint?: string | null
  tags?: string[]
  /** Fields that participate in the payload hash (detect material changes). */
  hashFields?: Record<string, unknown>
}

export interface ListResult {
  res: GatewayResponse
  /** null when unchanged / error — caller must not treat as empty list. */
  items: BoardItem[] | null
}

export interface BoardEngine {
  readonly ats: KnownAts
  list(board: BoardRef, gw: FetchGateway, purpose?: 'list' | 'probe'): Promise<ListResult>
  /** Optional per-posting detail fetch (description, compensation). Called once per new sighting. */
  detail?(board: BoardRef, item: BoardItem, gw: FetchGateway): Promise<{ description: string; salaryHint?: string | null; employmentTypeHint?: string | null } | null>
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£' }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m
  })
}

/**
 * HTML → structured plain text. Entities are decoded BEFORE tags are stripped (Greenhouse returns `content`
 * entity-escaped, so the old order left literal tags in descriptions — audit F3). Headings become "# " lines and
 * list items "- " lines so JD section parsing (Requirements vs Nice-to-have) still works downstream.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  let s = html
  if (!/<[a-z][\s\S]*?>/i.test(s) && /&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s) // escaped HTML
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n# ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|li|tr|ul|ol|section|table|blockquote)>/gi, '\n')
    .replace(/<(p|div|tr|ul|ol|section|table|blockquote)[^>]*>/gi, '\n')
    .replace(/<\/?(strong|b)[^>]*>/gi, '') // keep "<strong>Requirements:</strong>" as a clean heading line
    .replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+(?=- )/g, '\n')
    .replace(/^\s*-\s*$/gm, '')
    .trim()
}
