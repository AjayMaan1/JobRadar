import { NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { requireAdmin, authErrorResponse } from '../../../lib/auth'
import { log } from '@jobradar/log'

/**
 * Availability is computed by the worker (single adapter registry) and stored on the row
 * (sources.availability_issue, refreshed hourly). No duplicated domain list here anymore.
 */
export async function GET() {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  try {
    const sources = await prisma.source.findMany({ orderBy: [{ qualityScore: 'desc' }, { name: 'asc' }] })
    const data = sources.map((source) => ({
      ...source,
      runnable: source.enabled && !source.availabilityIssue,
      availabilityIssue: source.availabilityIssue ?? null,
    }))
    return NextResponse.json({ data })
  } catch (err) {
    log.error('GET /api/sources error:', err)
    return NextResponse.json({ error: 'Failed to fetch sources' }, { status: 500 })
  }
}
