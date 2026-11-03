/** Fixture HTTP router installed as globalThis.fetch. Records every request for assertions. */
export interface Recorded { url: string; method: string; headers: Record<string, string>; body?: string }
export interface RouteResponse { status?: number; headers?: Record<string, string>; body?: string | object }
export type Handler = (req: Recorded) => RouteResponse | Promise<RouteResponse>

export class FakeFetch {
  public requests: Recorded[] = []
  private routes: Array<{ match: (url: string, method: string) => boolean; handler: Handler }> = []
  private original = globalThis.fetch

  route(match: string | RegExp | ((url: string, method: string) => boolean), handler: Handler | RouteResponse) {
    const m = typeof match === 'function' ? match : (url: string) => (typeof match === 'string' ? url.startsWith(match) : match.test(url))
    this.routes.unshift({ match: m, handler: typeof handler === 'function' ? handler : () => handler })
    return this
  }

  install() {
    const self = this
    globalThis.fetch = (async (input: any, init: any = {}) => {
      const url = typeof input === 'string' ? input : input.url
      const method = (init.method ?? 'GET').toUpperCase()
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v)
      const rec: Recorded = { url, method, headers, body: init.body }
      self.requests.push(rec)
      const r = self.routes.find((x) => x.match(url, method))
      if (!r) return new Response('not found (no fixture)', { status: 404, headers: { 'content-type': 'text/plain' } })
      const res = await r.handler(rec)
      const isObj = typeof res.body === 'object' && res.body !== null
      const body = isObj ? JSON.stringify(res.body) : (res.body as string | undefined) ?? ''
      const h: Record<string, string> = { 'content-type': isObj ? 'application/json' : 'text/html', ...(res.headers ?? {}) }
      return new Response(res.status === 304 || method === 'HEAD' ? null : body, { status: res.status ?? 200, headers: h })
    }) as any
    return this
  }

  uninstall() { globalThis.fetch = this.original }
  count(pred: (r: Recorded) => boolean) { return this.requests.filter(pred).length }
  clear() { this.requests = [] }
}

/** Helper: ETag-aware JSON route — returns 304 when If-None-Match matches. */
export function etagJson(body: object, etag: string): Handler {
  return (req) => (req.headers['if-none-match'] === etag ? { status: 304, headers: { etag } } : { status: 200, headers: { etag }, body })
}
