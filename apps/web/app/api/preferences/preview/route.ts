import { NextRequest, NextResponse } from 'next/server'
import { lintPreferences, parsePreferences } from '@jobradar/prefs'
import { authErrorResponse, requireUser } from '../../../../lib/auth'
import { limitUser } from '../../../../lib/rate-limit'
import { services } from '../../../../lib/services'

/** Dry run: tier counts + examples over the most recent open jobs, nothing written (HLD §7 "preview before save"). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'mutate'); if (rl) return rl
    const body = (await req.json().catch(() => null)) as { doc?: unknown; sample?: number } | null
    if (!body?.doc) return NextResponse.json({ error: 'Body must be { doc }' }, { status: 400 })
    let doc
    try { doc = parsePreferences(body.doc) } catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 400 }) }
    const r = await services().evals.preview(doc, Math.min(5000, Math.max(100, body.sample ?? 2000)))
    return NextResponse.json({ ...r, warnings: lintPreferences(doc) })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Preview failed' }, { status: 500 })
  }
}
