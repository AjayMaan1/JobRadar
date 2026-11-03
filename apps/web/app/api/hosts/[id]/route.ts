import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { requireAdmin, authErrorResponse } from '../../../../lib/auth'
import type { Prisma } from '@jobradar/db'

/** Kill switch + circuit reset. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin() } catch (err) { return authErrorResponse(err)! }
  const { id } = await params
  const body = (await req.json()) as { enabled?: boolean; resetCircuit?: boolean; minIntervalMs?: number; dailyBudget?: number; maxConcurrency?: number }
  const data: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled
  if (body.resetCircuit) { data.circuitState = 'closed'; data.circuitOpenUntil = null }
  if (typeof body.minIntervalMs === 'number') data.minIntervalMs = Math.max(200, body.minIntervalMs)
  if (typeof body.dailyBudget === 'number') data.dailyBudget = Math.max(0, body.dailyBudget)
  if (typeof body.maxConcurrency === 'number') data.maxConcurrency = Math.max(1, body.maxConcurrency)
  const row = await prisma.hostPolicy.update({ where: { id }, data: data as Prisma.HostPolicyUpdateInput })
  return NextResponse.json(row)
}
