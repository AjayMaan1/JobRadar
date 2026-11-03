import { NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { requireAdmin, authErrorResponse } from '../../../lib/auth'

export async function GET() {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const rows = await prisma.hostPolicy.findMany({ orderBy: { host: 'asc' } })
  return NextResponse.json({ data: rows })
}
