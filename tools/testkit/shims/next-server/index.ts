/** Minimal next/server double so API route handlers can be invoked directly. */
export class NextRequest {
  url: string
  method: string
  headers: Headers
  cookies: { get(n: string): { value: string } | undefined }
  nextUrl: URL
  private _body: any
  constructor(url: string, init: { method?: string; body?: any; headers?: Record<string, string>; cookies?: Record<string, string> } = {}) {
    this.url = url
    this.method = init.method ?? 'GET'
    this.headers = new Headers(init.headers ?? {})
    this.nextUrl = new URL(url)
    const c = init.cookies ?? {}
    this.cookies = { get: (n) => (n in c ? { value: c[n] } : undefined) }
    this._body = init.body
  }
  async json() { return typeof this._body === 'string' ? JSON.parse(this._body) : this._body }
  async text() { return typeof this._body === 'string' ? this._body : JSON.stringify(this._body) }
  async formData() { return this._body }
}
export class NextResponse {
  headers: Headers
  cookies = { set: (_c: any) => undefined, get: () => undefined, delete: () => undefined }
  constructor(public body: any, public init: { status?: number; headers?: Record<string, string> } = {}) { this.headers = new Headers(init.headers ?? {}) }
  get status() { return this.init.status ?? 200 }
  async json() { return this.body }
  async text() { return typeof this.body === 'string' ? this.body : JSON.stringify(this.body) }
  static json(body: any, init: { status?: number; headers?: Record<string, string> } = {}) { return new NextResponse(body, init) }
  static next() { return new NextResponse(null) }
  static redirect(url: string | URL, status = 307) { return new NextResponse(null, { status, headers: { location: String(url) } }) }
}
export const useRouter = () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined })
export const useSearchParams = () => new URLSearchParams()
export const usePathname = () => '/'
const Link: any = null
export default Link
export type NextConfig = Record<string, any>
