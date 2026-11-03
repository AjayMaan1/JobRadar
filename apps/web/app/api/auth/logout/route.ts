import { NextRequest, NextResponse } from 'next/server'
import { destroySession, SESSION_COOKIE } from '../../../../lib/auth'

export async function POST(req: NextRequest) {
  await destroySession(req.cookies.get(SESSION_COOKIE)?.value)
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', expires: new Date(0) })
  return res
}
