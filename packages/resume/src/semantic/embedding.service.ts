import { createHash } from 'node:crypto'
import type { PrismaClient } from '@jobradar/db'
import { cosine, type EmbeddingProvider } from '@jobradar/llm'
import type { Chunk } from './chunks.js'

export interface StoredVector { chunkKey: string; text: string; vector: Float32Array }

export function hashText(t: string): string {
  return createHash('sha256').update(t).digest('hex')
}

export function toBytes(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}
export function fromBytes(b: Uint8Array): Float32Array {
  const buf = Buffer.from(b)
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

/**
 * Embeddings cached by (owner, chunk, model, text hash). Re-running is free when nothing changed; stale
 * chunk keys are removed so a shortened resume doesn't keep ghost bullets.
 */
export class EmbeddingService {
  constructor(private prisma: PrismaClient, readonly provider: EmbeddingProvider) {}

  async ensure(ownerType: string, ownerId: string, chunks: Chunk[]): Promise<StoredVector[]> {
    const model = this.provider.model
    const existing = await this.prisma.embedding.findMany({ where: { ownerType, ownerId, model } })
    const byKey = new Map(existing.map((e) => [e.chunkKey, e]))
    const todo = chunks.filter((c) => c.text && byKey.get(c.key)?.textHash !== hashText(c.text))
    if (todo.length) {
      const vectors = await this.provider.embed(todo.map((c) => c.text))
      for (let i = 0; i < todo.length; i++) {
        const c = todo[i]
        await this.prisma.embedding.upsert({
          where: { ownerType_ownerId_chunkKey_model: { ownerType, ownerId, chunkKey: c.key, model } },
          create: { ownerType, ownerId, chunkKey: c.key, model, text: c.text.slice(0, 2000), textHash: hashText(c.text), dims: vectors[i].length, vector: toBytes(vectors[i]) },
          update: { text: c.text.slice(0, 2000), textHash: hashText(c.text), dims: vectors[i].length, vector: toBytes(vectors[i]) },
        })
      }
    }
    const wanted = new Set(chunks.filter((c) => c.text).map((c) => c.key))
    const stale = existing.filter((e) => !wanted.has(e.chunkKey)).map((e) => e.id)
    if (stale.length) await this.prisma.embedding.deleteMany({ where: { id: { in: stale } } })
    return this.vectors(ownerType, ownerId)
  }

  async vectors(ownerType: string, ownerId: string): Promise<StoredVector[]> {
    const rows = await this.prisma.embedding.findMany({ where: { ownerType, ownerId, model: this.provider.model } })
    return rows.map((r) => ({ chunkKey: r.chunkKey, text: r.text, vector: fromBytes(r.vector) }))
  }

  /** Vectors for many owners in one query per 500 ids (audit NEW-09: removes the N+1 in fit computation). */
  async vectorsMany(ownerType: string, ownerIds: string[]): Promise<Map<string, StoredVector[]>> {
    const out = new Map<string, StoredVector[]>()
    for (let i = 0; i < ownerIds.length; i += 500) {
      const rows = await this.prisma.embedding.findMany({ where: { ownerType, ownerId: { in: ownerIds.slice(i, i + 500) }, model: this.provider.model } })
      for (const r of rows) {
        let arr = out.get(r.ownerId)
        if (!arr) { arr = []; out.set(r.ownerId, arr) }
        arr.push({ chunkKey: r.chunkKey, text: r.text, vector: fromBytes(r.vector) })
      }
    }
    return out
  }

  async has(ownerType: string, ownerId: string): Promise<boolean> {
    return (await this.prisma.embedding.count({ where: { ownerType, ownerId, model: this.provider.model } })) > 0
  }

  /** Transient embedding (search queries) — never stored. */
  async embedOne(text: string): Promise<Float32Array> {
    return (await this.provider.embed([text]))[0]
  }
}

/**
 * In-process cosine index over job chunk vectors (brute force). At ≤ 50k vectors a search is a few ms on a
 * laptop core; memory ≈ vectors × dims × 4 bytes (5k jobs × 3 chunks × 768 ≈ 46 MB).
 *
 * Audit NEW-08: pages on `updatedAt` (re-embeds are upserts that keep `createdAt`), is Map-keyed (O(1) upsert
 * instead of `findIndex`), evicts closed/deleted jobs on a periodic reconcile, and supports explicit eviction
 * from the erasure hooks.
 */
export class JobVectorIndex {
  private items = new Map<string, { jobId: string; chunkKey: string; vector: Float32Array }>()
  private byJob = new Map<string, Set<string>>()
  private loadedUntil: Date | null = null
  private lastRefresh = 0
  private lastReconcile = 0

  constructor(private prisma: PrismaClient, private model: string, private refreshMs = 60_000, private reconcileMs = 10 * 60_000) {}

  async refresh(force = false): Promise<void> {
    if (!force && Date.now() - this.lastRefresh < this.refreshMs) return
    const rows = await this.prisma.embedding.findMany({
      where: { ownerType: 'job', model: this.model, ...(this.loadedUntil ? { updatedAt: { gt: this.loadedUntil } } : {}) },
      orderBy: { updatedAt: 'asc' },
      select: { ownerId: true, chunkKey: true, vector: true, updatedAt: true },
    })
    for (const r of rows) {
      this.put(r.ownerId, r.chunkKey, fromBytes(r.vector))
      this.loadedUntil = r.updatedAt
    }
    this.lastRefresh = Date.now()
    if (force || Date.now() - this.lastReconcile > this.reconcileMs) await this.reconcile()
  }

  private put(jobId: string, chunkKey: string, vector: Float32Array): void {
    const k = `${jobId}\u0000${chunkKey}`
    this.items.set(k, { jobId, chunkKey, vector })
    let set = this.byJob.get(jobId)
    if (!set) { set = new Set(); this.byJob.set(jobId, set) }
    set.add(k)
  }

  /** Drop every vector of a job (erasure hook, closure). */
  evict(jobIds: Iterable<string>): number {
    let n = 0
    for (const id of jobIds) {
      const keys = this.byJob.get(id)
      if (!keys) continue
      for (const k of keys) { this.items.delete(k); n++ }
      this.byJob.delete(id)
    }
    return n
  }

  /** Owner-typed eviction so callers don't need to know the key layout; only 'job' is indexed here. */
  evictOwner(ownerType: string, ownerId: string): number {
    return ownerType === 'job' ? this.evict([ownerId]) : 0
  }

  /**
   * Remove jobs that are closed or no longer exist. Runs every `reconcileMs` from refresh(); one indexed query
   * over the ids we hold (chunked), never a full table scan.
   */
  async reconcile(): Promise<number> {
    this.lastReconcile = Date.now()
    const ids = [...this.byJob.keys()]
    if (!ids.length) return 0
    const alive = new Set<string>()
    for (let i = 0; i < ids.length; i += 1000) {
      const rows = await this.prisma.job.findMany({ where: { id: { in: ids.slice(i, i + 1000) }, closedAt: null }, select: { id: true } })
      for (const r of rows) alive.add(r.id)
    }
    return this.evict(ids.filter((id) => !alive.has(id)))
  }

  get size(): number { return this.items.size }
  get jobs(): number { return this.byJob.size }

  /** Top-k jobs by max chunk similarity. */
  search(query: Float32Array, k = 100): Array<{ jobId: string; score: number; chunkKey: string }> {
    const best = new Map<string, { score: number; chunkKey: string }>()
    for (const it of this.items.values()) {
      const s = cosine(query, it.vector)
      const cur = best.get(it.jobId)
      if (!cur || s > cur.score) best.set(it.jobId, { score: s, chunkKey: it.chunkKey })
    }
    return [...best.entries()].map(([jobId, v]) => ({ jobId, ...v })).sort((a, b) => b.score - a.score).slice(0, k)
  }

  vectorsFor(jobId: string): Array<{ chunkKey: string; vector: Float32Array }> {
    const keys = this.byJob.get(jobId)
    if (!keys) return []
    return [...keys].map((k) => this.items.get(k)!).map((i) => ({ chunkKey: i.chunkKey, vector: i.vector }))
  }
}
