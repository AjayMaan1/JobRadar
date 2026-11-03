import { describe, expect, it, beforeEach } from 'vitest'
import { SightingService } from './sighting.service.js'
import { createFakePrisma } from '../../../tools/testkit/fake-prisma.js'

let prisma: any, svc: SightingService
beforeEach(() => { prisma = createFakePrisma(); svc = new SightingService(prisma) })
const items = (...ids: string[]) => ids.map((externalId) => ({ externalId, hashFields: { t: externalId } }))

describe('SightingService.reconcile (full-list feeds)', () => {
  it('new → seen → missing×2 → gone → job closed; reappearance reopens', async () => {
    const job = await prisma.job.create({ data: { title: 'x', company: 'c', sourceName: 's', skills: '[]', canonicalHash: 'h' } })
    let r = await svc.reconcile({ feedKey: 'board:b', boardId: 'b', items: items('1', '2'), fullList: true })
    expect(r.newIds).toEqual(['1', '2'])
    await svc.linkJob('board:b', '1', job.id)
    r = await svc.reconcile({ feedKey: 'board:b', boardId: 'b', items: items('2'), fullList: true })
    expect(r.goneIds).toEqual([])
    expect((await prisma.jobSighting.findFirst({ where: { externalId: '1' } })).missingCount).toBe(1)
    r = await svc.reconcile({ feedKey: 'board:b', boardId: 'b', items: items('2'), fullList: true })
    expect(r.goneIds).toEqual(['1'])
    expect(r.closedJobIds).toEqual([job.id])
    expect((await prisma.job.findUnique({ where: { id: job.id } })).status).toBe('closed')
    r = await svc.reconcile({ feedKey: 'board:b', boardId: 'b', items: items('1', '2'), fullList: true })
    expect(r.reappearedIds).toEqual(['1'])
    expect(r.newIds).toEqual([])
    const j = await prisma.job.findUnique({ where: { id: job.id } })
    expect(j.closedAt).toBeNull()
    expect(j.status).toBe('new')
  })

  it('confirmMissing advances counters on unchanged polls', async () => {
    await svc.reconcile({ feedKey: 'board:b', boardId: 'b', items: items('1'), fullList: true })
    await svc.reconcile({ feedKey: 'board:b', boardId: 'b', items: [], fullList: true })
    const r = await svc.confirmMissing('board:b')
    expect(r.goneIds).toEqual(['1'])
  })

  it('a failed poll never counts (caller simply does not call reconcile)', async () => {
    await svc.reconcile({ feedKey: 'board:b', boardId: 'b', items: items('1'), fullList: true })
    expect((await prisma.jobSighting.findFirst({ where: { externalId: '1' } })).missingCount).toBe(0)
  })

  it('suspect drop (>50% shrink from ≥10) suspends closures', async () => {
    await svc.reconcile({ feedKey: 'board:b', boardId: 'b', items: items(...Array.from({ length: 12 }, (_, i) => String(i))), fullList: true })
    const r = await svc.reconcile({ feedKey: 'board:b', boardId: 'b', items: items('0', '1'), fullList: true, previousCount: 12 })
    expect(r.suspectDrop).toBe(true)
    expect(await prisma.jobSighting.count({ where: { missingCount: { gt: 0 } } })).toBe(0)
  })

  it('payload change is reported as changed, not new', async () => {
    await svc.reconcile({ feedKey: 'board:b', boardId: 'b', items: [{ externalId: '1', hashFields: { title: 'A' } }], fullList: true })
    const r = await svc.reconcile({ feedKey: 'board:b', boardId: 'b', items: [{ externalId: '1', hashFields: { title: 'B' } }], fullList: true })
    expect(r.changedIds).toEqual(['1'])
    expect(r.newIds).toEqual([])
  })

  it('keeps jobs.first_seen_at = earliest sighting across feeds', async () => {
    const job = await prisma.job.create({ data: { title: 'x', company: 'c', sourceName: 's', skills: '[]', canonicalHash: 'h', firstSeenAt: new Date() } })
    const old = new Date(Date.now() - 86400_000)
    await prisma.jobSighting.create({ data: { feedKey: 'source:s', sourceId: 's', externalId: 'agg-1', payloadHash: 'p', firstSeenAt: old, lastSeenAt: old } })
    await svc.linkJob('source:s', 'agg-1', job.id)
    expect((await prisma.job.findUnique({ where: { id: job.id } })).firstSeenAt.getTime()).toBe(old.getTime())
  })
})

describe('SightingService.reconcile (windowed feeds)', () => {
  it('never marks anything gone', async () => {
    await svc.reconcile({ feedKey: 'source:s', sourceId: 's', items: items('1', '2'), fullList: false })
    const r = await svc.reconcile({ feedKey: 'source:s', sourceId: 's', items: items('3'), fullList: false })
    expect(r.newIds).toEqual(['3'])
    expect(r.goneIds).toEqual([])
    expect(await prisma.jobSighting.count({ where: { missingCount: { gt: 0 } } })).toBe(0)
  })
})
