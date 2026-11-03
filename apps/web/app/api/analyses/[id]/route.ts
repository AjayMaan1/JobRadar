import { NextRequest, NextResponse } from 'next/server'
import { requireUser, unauthorized, Unauthorized } from '../../../../lib/auth'
import { services } from '../../../../lib/services'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireUser()
    const report = await services().analysis.getReport(id, user.id)
    if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(report)
  } catch (err) {
    if (err instanceof Unauthorized) return unauthorized()
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
