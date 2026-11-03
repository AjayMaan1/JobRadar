import { NextResponse, type NextRequest } from 'next/server'

/**
 * Edge gate (backlog C1-3 + audit v4):
 *  - no session cookie / bearer → pages redirect to /login, APIs get 401 (cookie presence only; `requireUser()`
 *    validates in every handler — Prisma does not run at the edge)
 *  - NEW-12: Origin/Sec-Fetch-Site check on state-changing requests (defence in depth next to SameSite=Lax)
 *  - NEW-16: request body caps before any handler buffers the body
 *  - NEW-10: HEALTH_TOKEN is honoured here AND in the handler (header forwarded)
 *  - NEW-15: AUTH_DISABLED is ignored in production
 */
const PUBLIC = [/^\/login$/, /^\/api\/auth\/(login|register|reset-request|reset|verify)$/, /^\/_next\//, /^\/favicon\.ico$/, /^\/robots\.txt$/, /^\/api\/metrics$/]
const SESSION_COOKIE = 'jr_session'
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_JSON_BYTES = parseInt(process.env.MAX_JSON_BODY_BYTES ?? String(256 * 1024), 10)
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BODY_BYTES ?? String(6 * 1024 * 1024), 10)

function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === '1' && (process.env.NODE_ENV !== 'production' || process.env.AUTH_DISABLED_I_KNOW_WHAT_I_AM_DOING === '1')
}

function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') return false
  const origin = req.headers.get('origin')
  if (!origin) return true // non-browser clients (curl, extension service worker) — protected by bearer/cookie rules
  try {
    const o = new URL(origin)
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host
    if (o.host === host) return true
    const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    return allowed.includes(o.origin)
  } catch {
    return false
  }
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const isApi = pathname.startsWith('/api/')
  // Browser extension API: CORS preflights carry no credentials; handlers validate the bearer token themselves.
  if (pathname.startsWith('/api/ext/') && req.method === 'OPTIONS') return NextResponse.next()

  if (isApi && MUTATING.has(req.method)) {
    // body caps
    const len = parseInt(req.headers.get('content-length') ?? '0', 10)
    const isUpload = pathname === '/api/resumes' && req.method === 'POST'
    if (Number.isFinite(len) && len > (isUpload ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES)) return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
    // CSRF defence in depth (cookie-authenticated browser requests only)
    if (req.cookies.get(SESSION_COOKIE)?.value && !sameOrigin(req)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  }

  if (authDisabled()) return NextResponse.next()
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next()
  // /api/health may be polled by monitors with a shared token (verified again, timing-safe, in the handler)
  if (pathname === '/api/health' && process.env.HEALTH_TOKEN && req.headers.get('x-health-token')) return NextResponse.next()
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next()
  if (isApi && req.headers.get('authorization')?.startsWith('Bearer ')) return NextResponse.next() // extension / API token; validated in handler
  if (isApi) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = `?next=${encodeURIComponent(pathname + search)}`
  return NextResponse.redirect(url)
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] }
