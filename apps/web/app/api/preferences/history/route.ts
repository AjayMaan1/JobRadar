import { NextResponse } from 'next/server'
import { authErrorResponse, requireUser } from '../../../../lib/auth'
import { services } from '../../../../lib/services'

export async function GET() {
  try {
    const user = await requireUser()
    return NextResponse.json({ data: await services().preferences.history(user.id) })
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
