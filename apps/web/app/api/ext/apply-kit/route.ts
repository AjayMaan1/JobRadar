import { NextRequest } from 'next/server'
import { prisma } from '@jobradar/db'
import { ExtKitService } from '@jobradar/resume'
import { log } from '@jobradar/log'
import { extError, extJson, preflight, requireExtensionUser } from '../../../../lib/ext'
import { limitUser } from '../../../../lib/rate-limit'
import { services } from '../../../../lib/services'

export async function OPTIONS(req: NextRequest) { return preflight(req) }

/** ?url=<application page url> → the kit: profile basics, file links (bearer-fetchable), answers, cover note, matched job. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireExtensionUser(req)
    const rl = await limitUser(user.id, 'mutate'); if (rl) return rl
    const url = req.nextUrl.searchParams.get('url') ?? ''
    if (!/^https?:\/\//i.test(url) || url.length > 2000) return extJson(req, { error: 'url query parameter required' }, { status: 400 })
    const kit = await new ExtKitService(prisma, services().store).kit(user.id, url)
    return extJson(req, kit)
  } catch (err) {
    log.warn('GET /api/ext/apply-kit failed', { reason: (err as Error).message })
    return extError(req, err)
  }
}
