import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import type { User } from '@jobradar/db'
import { services } from './services'
import { log } from '@jobradar/log'

/**
 * Session auth (backlog C1-2..C1-4). In-house rather than Auth.js to avoid a beta dependency:
 *  - passwords: scrypt (N=2^15) with per-user salt
 *  - sessions: random 256-bit token in an httpOnly cookie; only its SHA-256 is stored; 30-day sliding expiry
 *  - `AUTH_DISABLED=1` (dev only): auto-provisions ADMIN_EMAIL without a password, like Phase 1
 * Replace with Auth.js later by re-implementing `currentUser()` and `middleware.ts`.
 */
export const SESSION_COOKIE = 'jr_session'
const SESSION_DAYS = 30
/** Absolute cap (audit NEW-07): a sliding session can never outlive this, however active it is. */
const SESSION_MAX_DAYS = parseInt(process.env.SESSION_MAX_DAYS ?? '90', 10)
const SCRYPT_N = 2 ** 15
export const MIN_PASSWORD_LENGTH = 10

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password.normalize('NFKC'), salt, 64, { N: SCRYPT_N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
  return `scrypt$${SCRYPT_N}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [algo, nStr, saltB64, hashB64] = stored.split('$')
  if (algo !== 'scrypt') return false
  const expected = Buffer.from(hashB64, 'base64url')
  const actual = scryptSync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, { N: parseInt(nStr, 10), r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Dev-only bypass. Refused in production builds (audit NEW-15): one env var must not be able to open every
 * route, including admin ones, on a deployed box.
 */
export const authDisabled = (): boolean => {
  if (process.env.AUTH_DISABLED !== '1') return false
  if (process.env.NODE_ENV === 'production' && process.env.AUTH_DISABLED_I_KNOW_WHAT_I_AM_DOING !== '1') {
    if (!warnedAuthDisabled) { warnedAuthDisabled = true; log.error('AUTH_DISABLED=1 ignored in production (set AUTH_DISABLED_I_KNOW_WHAT_I_AM_DOING=1 to force)') }
    return false
  }
  return true
}
let warnedAuthDisabled = false

export async function createSession(userId: string, meta: { userAgent?: string | null; ip?: string | null } = {}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000)
  await prisma.session.create({ data: { userId, tokenHash: tokenHash(token), expiresAt, userAgent: meta.userAgent?.slice(0, 200) ?? null, ip: meta.ip?.slice(0, 64) ?? null } })
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
  return { token, expiresAt }
}

export function sessionCookie(token: string, expiresAt: Date) {
  return { name: SESSION_COOKIE, value: token, httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', expires: expiresAt }
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return
  await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } })
}

let devUser: { at: number; user: User } | null = null

/** Resolve the current user from the session cookie (null when signed out / expired). */
export async function currentUser(): Promise<User | null> {
  if (authDisabled()) {
    if (devUser && Date.now() - devUser.at < 60_000) return devUser.user
    const email = (process.env.ADMIN_EMAIL ?? 'owner@jobradar.local').toLowerCase()
    const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email, role: 'admin', name: process.env.ADMIN_NAME ?? null } })
    devUser = { at: Date.now(), user }
    return user
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) {
    // Browser extension / API clients: bearer token instead of a cookie (only on /api/ext/* by convention,
    // but harmless elsewhere — the token is bound to one user and revocable).
    const auth = (await headers()).get('authorization')
    return auth ? userFromBearer(auth) : null
  }
  const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } })
  if (!session || session.expiresAt.getTime() < Date.now()) return null
  if (Date.now() - session.createdAt.getTime() > SESSION_MAX_DAYS * 86400_000) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined)
    return null
  }
  // sliding expiry, touched at most hourly
  if (Date.now() - session.lastSeenAt.getTime() > 3600_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) } }).catch(() => undefined)
  }
  return session.user
}

export class Unauthorized extends Error {}
export class Forbidden extends Error {}

export async function requireUser(): Promise<User> {
  const u = await currentUser()
  if (!u) throw new Unauthorized('Sign in required')
  return u
}

/** Operator routes (hosts, boards, companies, crawl). */
export async function requireAdmin(): Promise<User> {
  const u = await requireUser()
  if (u.role !== 'admin') throw new Forbidden('Admin role required')
  return u
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
}
export function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/** Map auth errors to responses inside route handlers' catch blocks. Returns null for other errors. */
export function authErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof Unauthorized) return unauthorized()
  if (err instanceof Forbidden) return forbidden()
  return null
}

/**
 * Client IP for rate limits and session records. `x-forwarded-for` is attacker-controlled unless a proxy we
 * trust sets it (audit NEW-04): only honoured when TRUSTED_PROXY=1 (or when behind Vercel/Cloudflare headers).
 * Without a trusted proxy there is no reliable IP in a Next.js route handler, so limits fall back to a shared
 * bucket — per-user limits (`limitUser`) are the real control for authenticated actions.
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers()
  if (process.env.TRUSTED_PROXY === '1') {
    const xff = h.get('x-forwarded-for')?.split(',')[0]?.trim()
    return xff || h.get('x-real-ip') || h.get('cf-connecting-ip') || null
  }
  return h.get('cf-connecting-ip') ?? null
}

// ── Account-level brute-force protection (audit NEW-07) ───────────────────────────────────────────────
const LOCK_ATTEMPTS = parseInt(process.env.LOGIN_LOCK_ATTEMPTS ?? '8', 10)
const LOCK_WINDOW_SEC = parseInt(process.env.LOGIN_LOCK_WINDOW_SEC ?? '900', 10)
const failures = new Map<string, { n: number; exp: number }>()

/** Returns seconds until the account unlocks, or 0. Redis-backed with an in-memory fallback. */
export async function accountLocked(email: string): Promise<number> {
  const key = `auth:fail:${email}`
  try {
    const { redis } = services()
    const n = parseInt((await redis.get(key)) ?? '0', 10)
    if (n < LOCK_ATTEMPTS) return 0
    const ttl = await redis.ttl(key)
    return ttl > 0 ? ttl : LOCK_WINDOW_SEC
  } catch {
    const f = failures.get(key)
    if (!f || f.exp < Date.now()) return 0
    return f.n >= LOCK_ATTEMPTS ? Math.ceil((f.exp - Date.now()) / 1000) : 0
  }
}
export async function recordLoginFailure(email: string): Promise<void> {
  const key = `auth:fail:${email}`
  try {
    const { redis } = services()
    const n = await redis.incr(key)
    if (n === 1) await redis.expire(key, LOCK_WINDOW_SEC)
  } catch {
    const f = failures.get(key)
    if (f && f.exp > Date.now()) f.n++
    else failures.set(key, { n: 1, exp: Date.now() + LOCK_WINDOW_SEC * 1000 })
  }
}
export async function clearLoginFailures(email: string): Promise<void> {
  const key = `auth:fail:${email}`
  failures.delete(key)
  try { await services().redis.del(key) } catch { /* memory only */ }
}

// ── Single-use tokens: password reset, e-mail verification, extension pairing (audit NEW-07) ─────────
export type TokenKind = 'password_reset' | 'email_verify' | 'extension'

export async function issueToken(userId: string, kind: TokenKind, ttlMinutes: number): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  // one live token per (user, kind): issuing a new one invalidates older unused ones
  await prisma.authToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } })
  await prisma.authToken.create({ data: { userId, kind, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) } })
  return token
}

/** Consume a token: returns the user id or null. Tokens are single-use and expire. */
export async function consumeToken(token: string, kind: TokenKind): Promise<string | null> {
  if (!token || token.length > 200) return null
  const row = await prisma.authToken.findUnique({ where: { tokenHash: tokenHash(token) } })
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt.getTime() < Date.now()) return null
  const r = await prisma.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
  return r.count === 1 ? row.userId : null // a concurrent consumer loses
}

/** Long-lived bearer token for the browser extension (C12 pre-requisite). Verified without a cookie. */
export async function userFromBearer(authorization: string | null): Promise<User | null> {
  const m = authorization?.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const row = await prisma.authToken.findUnique({ where: { tokenHash: tokenHash(m[1].trim()) }, include: { user: true } })
  if (!row || row.kind !== 'extension' || row.usedAt || row.expiresAt.getTime() < Date.now()) return null
  return row.user
}

export function requireVerification(): boolean {
  return process.env.SIGNUP_REQUIRE_VERIFICATION === 'true'
}

/** Public base URL for links in e-mails (reset/verify). */
export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

/**
 * First-run bootstrap: when there are no users, ADMIN_EMAIL + ADMIN_PASSWORD create the owner account.
 * Also usable via `pnpm user:create`. Returns the user or null when not applicable.
 */
export async function bootstrapAdmin(): Promise<User | null> {
  const email = process.env.ADMIN_EMAIL?.toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return null
  const count = await prisma.user.count()
  if (count > 0) {
    // an existing owner row without a password (created in Phase 1 single-user mode) gets one
    const u = await prisma.user.findUnique({ where: { email } })
    if (u && !u.passwordHash) return prisma.user.update({ where: { id: u.id }, data: { passwordHash: hashPassword(password), role: 'admin' } })
    return null
  }
  return prisma.user.create({ data: { email, role: 'admin', name: process.env.ADMIN_NAME ?? null, passwordHash: hashPassword(password) } })
}
