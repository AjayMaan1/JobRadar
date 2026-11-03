import { describe, it, expect } from 'vitest'
import { createFakePrisma } from '../../../../tools/testkit/fake-prisma.js'
import { JobVectorIndex, toBytes } from './embedding.service.js'

const vec = (x: number, y: number) => { const n = Math.hypot(x, y); return new Float32Array([x / n, y / n]) }
const put = (prisma: any, jobId: string, chunkKey: string, v: Float32Array, updatedAt = new Date()) =>
  prisma.embedding.upsert({ where: { ownerType_ownerId_chunkKey_model: { ownerType: 'job', ownerId: jobId, chunkKey, model: 'm' } }, create: { ownerType: 'job', ownerId: jobId, chunkKey, model: 'm', text: 't', textHash: 'h', dims: 2, vector: toBytes(v), updatedAt }, update: { vector: toBytes(v), updatedAt } })

describe('JobVectorIndex (audit NEW-08)', () => {
  it('picks up re-embedded (upserted) vectors via updatedAt and evicts closed/deleted jobs on reconcile', async () => {
    const prisma = createFakePrisma()
    const j1 = await prisma.job.create({ data: { title: 'A', company: 'C', sourceName: 's', skills: '[]', canonicalHash: 'h1' } })
    const j2 = await prisma.job.create({ data: { title: 'B', company: 'C', sourceName: 's', skills: '[]', canonicalHash: 'h2' } })
    await put(prisma, j1.id, 'head', vec(1, 0), new Date(Date.now() - 1000))
    await put(prisma, j2.id, 'head', vec(0, 1), new Date(Date.now() - 1000))
    const idx = new JobVectorIndex(prisma as never, 'm', 0, 0)
    await idx.refresh(true)
    expect(idx.jobs).toBe(2)
    expect(idx.search(vec(1, 0), 1)[0].jobId).toBe(j1.id)

    // Re-embed j1 to point the other way (same row, createdAt unchanged, updatedAt bumped) → index must follow.
    await put(prisma, j1.id, 'head', vec(0, 1), new Date(Date.now() + 1000))
    await idx.refresh(true)
    expect(idx.size).toBe(2) // replaced, not duplicated
    expect(idx.search(vec(1, 0), 2).map((r) => r.score < 0.5)).toEqual([true, true])

    // Close j2, delete j1 → reconcile evicts both.
    await prisma.job.update({ where: { id: j2.id }, data: { closedAt: new Date() } })
    await prisma.job.delete({ where: { id: j1.id } })
    await idx.refresh(true)
    expect(idx.jobs).toBe(0)
    expect(idx.size).toBe(0)
  })

  it('evict / evictOwner drop all chunks of a job', async () => {
    const prisma = createFakePrisma()
    const j = await prisma.job.create({ data: { title: 'A', company: 'C', sourceName: 's', skills: '[]', canonicalHash: 'h1' } })
    await put(prisma, j.id, 'head', vec(1, 0)); await put(prisma, j.id, 'desc:0', vec(1, 1))
    const idx = new JobVectorIndex(prisma as never, 'm', 0, 1e9)
    await idx.refresh(true)
    expect(idx.vectorsFor(j.id)).toHaveLength(2)
    expect(idx.evictOwner('profile', j.id)).toBe(0)
    expect(idx.evictOwner('job', j.id)).toBe(2)
    expect(idx.size).toBe(0)
  })
})
