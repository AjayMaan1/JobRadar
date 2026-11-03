import { NextRequest, NextResponse } from 'next/server'
import { authErrorResponse, requireAdmin } from '../../../../lib/auth'
import { services } from '../../../../lib/services'

/** Deployment crawl policy = union of users' preferences (HLD §8): scope, suggestions, apply. Admin only. */
export async function GET() {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const { crawlScope } = services()
  const [scope, suggestions] = await Promise.all([crawlScope.scope(true), crawlScope.suggestions()])
  return NextResponse.json({ scope, suggestions })
}

export async function POST(req: NextRequest) {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const body = (await req.json().catch(() => ({}))) as { metro?: string; boardIds?: string[] }
  if (!body.metro) return NextResponse.json({ error: 'metro required' }, { status: 400 })
  const applied = await services().crawlScope.applyMetro(body.metro, body.boardIds)
  return NextResponse.json({ applied })
}
