import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { ErasureService } from '@jobradar/resume'
import { log } from '@jobradar/log'
import { authErrorResponse, requireUser, SESSION_COOKIE } from '../../../lib/auth'
import { services } from '../../../lib/services'

/**
 * Full erasure (backlog C11-1, audit NEW-01): vectors (profile + every resume version, incl. the chunk text
 * stored with them) → object-store prefix → user row (sessions, profile, resumes → versions → reports →
 * suggestions, job states, applications, job fits cascade).
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser()
    const body = (await req.json().catch(() => ({}))) as { confirm?: string }
    if (body.confirm !== user.email) return NextResponse.json({ error: 'Send { confirm: <your email> } to erase your account' }, { status: 400 })
    const { store, vectorIndex } = services()
    const r = await new ErasureService(prisma, store).eraseUser(user.id)
    vectorIndex?.evictOwner('profile', user.id)
    const res = NextResponse.json({ deleted: true, files: r.files, embeddings: r.embeddings })
    res.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', expires: new Date(0) })
    return res
  } catch (err) {
    const a = authErrorResponse(err); if (a) return a
    log.error('DELETE /api/me failed', err as Error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
