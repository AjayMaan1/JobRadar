import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@jobradar/db'
import { userFromBearer } from './auth'

/**
 * Browser-extension API helpers (docs/HLD-browser-extension.md §2): bearer-only auth, CORS restricted to
 * extension origins (or EXTENSION_ORIGINS), preflight handling. Cookies are never accepted here, so the
 * middleware's CSRF origin check does not apply and cookie-based CSRF is impossible by construction.
 */
const EXT_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\/[a-z0-9-]+$/i

export function allowedExtensionOrigin(origin: string | null): string | null {
  if (!origin) return null
  if (EXT_ORIGIN.test(origin)) return origin
  const allow = (process.env.EXTENSION_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return allow.includes(origin) || allow.includes('*') ? origin : null
}

export function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = allowedExtensionOrigin(req.headers.get('origin'))
  if (!origin) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}

export function preflight(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

export function extJson(req: NextRequest, body: unknown, init: { status?: number } = {}): NextResponse {
  return NextResponse.json(body, { status: init.status ?? 200, headers: corsHeaders(req) })
}

/** Bearer-only: the extension never has a session cookie. */
export async function requireExtensionUser(req: NextRequest): Promise<User> {
  const u = await userFromBearer(req.headers.get('authorization'))
  if (!u) throw new ExtUnauthorized()
  return u
}

export class ExtUnauthorized extends Error {
  constructor() { super('Extension token missing, invalid, expired or revoked — pair the extension again from Profile → Account'); this.name = 'ExtUnauthorized' }
}

export function extError(req: NextRequest, err: unknown): NextResponse {
  if (err instanceof ExtUnauthorized) return extJson(req, { error: err.message, code: 'unauthorized' }, { status: 401 })
  return extJson(req, { error: (err as Error).message ?? 'Failed' }, { status: 500 })
}
