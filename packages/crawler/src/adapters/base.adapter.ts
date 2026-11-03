import type { RawJob, SourceConfig } from '../types.js'
import type { FetchGateway } from '../gateway/index.js'
import { isRelevantRole as sharedIsRelevantRole } from '../relevance.js'

const PREFERRED_REMOTE_PATTERNS = [
  /\bworldwide\b/i, /\bglobal\b/i, /\banywhere\b/i, /\bindia\b/i, /\bapac\b/i, /\basia\b/i, /\bemea\b/i,
  /\beurope\b/i, /\btimezone overlap\b/i, /\boverlap hours?\b/i, /\butc[+-]?\d{0,2}/i, /\bgmt[+-]?\d{0,2}/i, /\bcontract(or)?\b/i,
]

const COUNTRY_RESTRICTED_PATTERNS = [
  /\bremote \((us|usa|canada|uk|united kingdom|europe|eu)\)\b/i,
  /\b(us|usa|canada|uk|united kingdom|europe|eu)[ -]only\b/i,
  /\bmust be based in\b/i,
  /\bright to work in\b/i,
]

const APAC_COUNTRY_CODES = new Set(['AU','BD','CN','HK','ID','IN','JP','KH','KR','LK','MM','MY','NP','NZ','PH','PK','SG','TH','TW','VN'])
const EMEA_COUNTRY_CODES = new Set(['AE','AT','BE','BH','CH','CZ','DE','DK','EE','EG','ES','FI','FR','GB','GR','HR','HU','IE','IL','IT','KE','KW','LT','LU','LV','MA','NG','NL','NO','OM','PL','PT','QA','RO','RS','SA','SE','SI','SK','TR','UA','ZA'])

/** Per-crawl context so adapter fetches are attributed to a source in fetch_runs. */
export interface AdapterFetchContext {
  sourceId?: string | null
}

export abstract class BaseAdapter {
  abstract readonly sourceName: string

  abstract fetch(config: SourceConfig): Promise<RawJob[]>

  availabilityIssue(_config: SourceConfig): string | null {
    return null
  }

  /** Injected once at worker start. All adapter HTTP goes through the gateway. */
  static gateway: FetchGateway | null = null
  static context: AdapterFetchContext = {}

  protected async fetchWithRetry(
    url: string,
    opts: RequestInit = {},
    retries = 2
  ): Promise<Response> {
    const gw = BaseAdapter.gateway
    if (!gw) {
      // Fallback for standalone scripts (health-check, fetch-recent) without Redis/DB.
      return this.plainFetch(url, opts, retries)
    }
    const kind: 'api' | 'html' = /text\/html/i.test(String((opts.headers as Record<string, string>)?.Accept ?? '')) ? 'html' : 'api'
    let last: { status: number; error?: string } | null = null
    for (let attempt = 1; attempt <= retries; attempt++) {
      const res = await gw.fetch({
        url,
        method: (opts.method as 'GET' | 'POST') ?? 'GET',
        headers: (opts.headers as Record<string, string>) ?? {},
        body: typeof opts.body === 'string' ? opts.body : undefined,
        purpose: 'aggregator',
        kind,
        sourceId: BaseAdapter.context.sourceId ?? null,
      })
      if (res.outcome === 'changed' || res.outcome === 'unchanged') {
        return new Response(res.body ?? '', { status: res.status ?? 200, headers: { 'content-type': res.contentType ?? 'text/plain' } })
      }
      last = { status: res.status ?? 0, error: res.error }
      // blocked / rate_limited / skipped: do not hammer — bail immediately
      if (res.outcome === 'blocked' || res.outcome === 'rate_limited' || res.outcome === 'skipped' || res.outcome === 'not_found') break
      await new Promise((r) => setTimeout(r, attempt * 1500))
    }
    throw new Error(`Fetch failed for ${url}: ${last?.error ?? 'unknown'} (HTTP ${last?.status ?? 'n/a'})`)
  }

  private async plainFetch(url: string, opts: RequestInit, retries: number): Promise<Response> {
    const headers = {
      'User-Agent': 'JobRadar/2.0 (standalone script)',
      Accept: 'application/json, text/html, */*',
      ...((opts.headers as Record<string, string>) ?? {}),
    }
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { ...opts, headers })
        if (res.ok || res.status === 304) return res
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await new Promise((r) => setTimeout(r, attempt * 2000))
          continue
        }
        throw new Error(`HTTP ${res.status} from ${url}`)
      } catch (err) {
        if (attempt === retries) throw err
        await new Promise((r) => setTimeout(r, attempt * 1500))
      }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts`)
  }

  protected buildCacheKey(config: SourceConfig): string {
    return `cache:source:${config.id}:raw`
  }

  protected filterRelevantJobs(jobs: RawJob[]): RawJob[] {
    return jobs.filter((job) =>
      this.isRelevantRole(job.title, job.tags ?? [], job.description ?? '')
    )
  }

  protected isRelevantRole(title: string, tags: string[] = [], description = ''): boolean {
    return sharedIsRelevantRole(title, tags, description)
  }

  protected hasPreferredRemoteSignals(...parts: Array<string | null | undefined>): boolean {
    const text = parts.filter(Boolean).join(' ')
    return PREFERRED_REMOTE_PATTERNS.some((pattern) => pattern.test(text))
  }

  protected isExplicitlyCountryRestricted(...parts: Array<string | null | undefined>): boolean {
    const text = parts.filter(Boolean).join(' ')
    return COUNTRY_RESTRICTED_PATTERNS.some((pattern) => pattern.test(text))
  }

  protected summarizeCountryCodes(codes: string[] = []): string[] {
    if (codes.length === 0) return ['Worldwide']

    const normalized = codes.map((code) => code.toUpperCase())
    const labels = new Set<string>()

    if (normalized.includes('IN')) labels.add('India')
    if (normalized.some((code) => APAC_COUNTRY_CODES.has(code))) labels.add('APAC')
    if (normalized.some((code) => EMEA_COUNTRY_CODES.has(code))) labels.add('EMEA')
    if (normalized.length >= 25) labels.add('Global')

    return [...labels]
  }

  protected joinMetadataLines(lines: Array<string | null | undefined>): string {
    return lines
      .map((line) => line?.trim())
      .filter(Boolean)
      .join('\n')
  }
}
