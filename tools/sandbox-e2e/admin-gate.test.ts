/**
 * E2E (simulated infra): the User vs Admin separation is enforced on the server, not just hidden in the sidebar.
 *   app/admin/layout.tsx gates every /admin/* route by session role; admin APIs use requireAdmin.
 *     tsx tools/testkit/run-tests.ts e2e-admin-gate tools/sandbox-e2e/admin-gate.test.ts
 */
process.env.AUTH_DISABLED = '0'
process.env.QUEUE_MODE = 'inline'
process.env.LLM_PROVIDER = 'none'
process.env.EMBEDDING_PROVIDER = 'none'
process.env.STORAGE_SIGNING_SECRET = 'sandbox-signing-secret-0123456789'

import { describe, it, expect, beforeAll } from 'vitest'
import * as React from 'react'
;(globalThis as any).React = React // the layout's JSX compiles to React.createElement under tsx
import { prisma } from '@jobradar/db'
import { NextRequest } from 'next/server'
import { setRequestContext } from 'next/headers'
import { createSession, SESSION_COOKIE } from '../../apps/web/lib/auth.js'
import AdminLayout from '../../apps/web/app/admin/layout.js'
import { GET as healthGET } from '../../apps/web/app/api/health/route.js'
import { GET as queuesGET } from '../../apps/web/app/api/admin/queues/route.js'
import { GET as meGET } from '../../apps/web/app/api/auth/me/route.js'

let adminCookie = '', userCookie = ''
const as = (cookie: string) => setRequestContext({ cookies: cookie ? { [SESSION_COOKIE]: cookie } : {}, headers: {} })
const render = async () => { try { await AdminLayout({ children: null }); return 'rendered' } catch (e) { const m = (e as Error).message.match(/^NEXT_REDIRECT:(.*)$/); if (m) return `redirect:${m[1]}`; throw e } }

describe('E2E · User vs Admin separation is server-side', () => {
  beforeAll(async () => {
    const admin = await prisma.user.create({ data: { email: 'admin@sandbox.local', role: 'admin', passwordHash: 'x' } })
    const user = await prisma.user.create({ data: { email: 'user@sandbox.local', role: 'user', passwordHash: 'x' } })
    adminCookie = (await createSession(admin.id)).token
    userCookie = (await createSession(user.id)).token
  })

  it('1. /admin/* layout: signed-out → /login?next=/admin, candidate → /, admin → renders', async () => {
    as(''); expect(await render()).toBe('redirect:/login?next=/admin')
    as(userCookie); expect(await render()).toBe('redirect:/')
    as(adminCookie); expect(await render()).toBe('rendered')
  })

  it('2. admin APIs (/api/health, /api/admin/queues) are 401/403 for candidates and 200 for admins', async () => {
    as(userCookie)
    expect((await healthGET(new NextRequest('http://local/api/health') as any)).status).toBe(403)
    expect((await queuesGET(new NextRequest('http://local/api/admin/queues') as any)).status).toBe(403)
    as('')
    expect((await healthGET(new NextRequest('http://local/api/health') as any)).status).toBe(401)
    as(adminCookie)
    expect((await healthGET(new NextRequest('http://local/api/health') as any)).status).toBe(200)
    expect((await queuesGET(new NextRequest('http://local/api/admin/queues') as any)).status).toBe(200)
  })

  it('3. the sidebar decides the Admin group from /api/auth/me role — which is the session role, not a client flag', async () => {
    as(userCookie)
    const me = await (await meGET(new NextRequest('http://local/api/auth/me') as any)).json()
    expect(me.user.role).toBe('user')
    as(adminCookie)
    expect((await (await meGET(new NextRequest('http://local/api/auth/me') as any)).json()).user.role).toBe('admin')
  })
})
