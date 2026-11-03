import { NextRequest, NextResponse } from 'next/server'
import { verifySignedQuery } from '@jobradar/storage'
import { requireUser, unauthorized, Unauthorized } from '../../../lib/auth'
import { services } from '../../../lib/services'
import { corsHeaders, preflight } from '../../../lib/ext'

export async function OPTIONS(req: NextRequest) { return preflight(req) }
import { log } from '@jobradar/log'

/** Serves objects for the LOCAL storage driver via HMAC-signed, expiring links (S3 driver uses presigned S3 URLs). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const { store } = services()
    if (store.driver !== 'local') return NextResponse.json({ error: 'Not available for this storage driver' }, { status: 404 })
    const q = new URL(req.url).searchParams
    const key = verifySignedQuery(process.env.STORAGE_SIGNING_SECRET ?? '', { key: q.get('key'), exp: q.get('exp'), sig: q.get('sig') })
    if (!key) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 403 })
    // defence in depth: signed links are per-user-scoped keys
    if (!key.startsWith(`users/${user.id}/`)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const meta = await store.head(key)
    if (!meta) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const body = await store.get(key)
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'content-type': meta.contentType ?? 'application/octet-stream',
        'content-length': String(body.length),
        'content-disposition': `inline; filename="${(meta.filename ?? key.split('/').pop() ?? 'file').replace(/"/g, '')}"`,
        'cache-control': 'private, no-store',
        ...corsHeaders(req),
      },
    })
  } catch (err) {
    if (err instanceof Unauthorized) return unauthorized()
    log.error('GET /api/files error:', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
