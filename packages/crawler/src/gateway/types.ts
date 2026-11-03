export type FetchPurpose = 'list' | 'detail' | 'probe' | 'discovery' | 'liveness' | 'robots' | 'aggregator'

export type GatewayOutcome =
  | 'unchanged'
  | 'changed'
  | 'error'
  | 'rate_limited'
  | 'blocked'
  | 'timeout'
  | 'not_found'
  | 'skipped' // circuit open / host disabled / budget exhausted — nothing was sent

export interface GatewayRequest {
  url: string
  method?: 'GET' | 'POST' | 'HEAD'
  headers?: Record<string, string>
  body?: string
  /** Conditional request state from the previous successful fetch. */
  etag?: string | null
  lastModified?: string | null
  bodyHash?: string | null
  timeoutMs?: number
  purpose: FetchPurpose
  /** 'html' requests are subject to robots.txt and the *.html host policy. */
  kind?: 'api' | 'html'
  boardId?: string | null
  sourceId?: string | null
  /** When true, a 3xx redirect is reported instead of followed (liveness checks). */
  manualRedirect?: boolean
  /** Per-request body cap (bytes); default CRAWLER_CONFIG.maxBodyBytes. */
  maxBodyBytes?: number
  /** Skip fetch_runs logging (robots, tiny discovery calls). */
  quiet?: boolean
}

export interface GatewayResponse {
  outcome: GatewayOutcome
  status: number | null
  body: string | null
  etag: string | null
  lastModified: string | null
  bodyHash: string | null
  durationMs: number
  bytes: number
  host: string
  error?: string
  retryAfterMs?: number
  redirectLocation?: string | null
  contentType?: string | null
}
