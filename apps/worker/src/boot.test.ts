import { describe, expect, it, vi } from 'vitest'

/**
 * Boot smoke test (backlog C0-2): every worker module must load and the scheduler must register its jobs
 * with mocked infrastructure. The corrupted scheduler.ts that shipped in v2 would have failed here.
 */
const upserts: string[] = []
vi.mock('bullmq', () => {
  class Queue {
    constructor(public name: string) {}
    async upsertJobScheduler(key: string) { upserts.push(`${this.name}:${key}`) }
    async getJobSchedulers() { return [] }
    async removeJobScheduler() {}
    async add() { return { id: 'x' } }
    async close() {}
  }
  class Worker { constructor(public name: string) {} on() { return this } async close() {} }
  return { Queue, Worker }
})
vi.mock('ioredis', () => ({ default: class { constructor() {} on() {} disconnect() {} } }))
vi.mock('@jobradar/db', () => ({ prisma: { source: { findMany: async () => [] }, candidateProfile: { findFirst: async () => null }, user: { count: async () => 1, findFirst: async () => null }, alertChannel: { count: async () => 0 }, preferencePreset: { findFirst: async () => null, create: async () => ({}) } } }))

process.env.LLM_PROVIDER = 'none'
process.env.EMBEDDING_PROVIDER = 'fake'
process.env.STORAGE_SIGNING_SECRET = 'boot-test-secret-0123456789'
process.env.STORAGE_LOCAL_ROOT = '/tmp/jobradar-boot-test'

describe('worker boot', () => {
  it('all worker modules load', { timeout: 30_000 }, async () => {
    await import('./context.js')
    await import('./workers/crawl.worker.js')
    await import('./workers/poll-board.worker.js')
    await import('./workers/enrich.worker.js')
    await import('./workers/discovery.worker.js')
    await import('./workers/maintenance.worker.js')
    await import('./workers/notify.worker.js')
    await import('./ops.js')
    await import('./workers/prefs.worker.js')
    const r = await import('./workers/resume.worker.js')
    expect(typeof r.startResumeParseWorker).toBe('function')
  })
  it('scheduler registers every repeatable job', async () => {
    const { setupSchedules } = await import('./scheduler.js')
    await setupSchedules()
    const keys = upserts.map((k) => k.split(':')[1])
    for (const k of ['dispatch', 'probe-sweep', 'resolve-sweep', 'tiering', 'health', 'sync-schedules', 'liveness', 'retention', 'discover-hn', 'discover-github', 'discover-yc', 'discover-funding', 'daily-digest', 'follow-ups', 'embed-backfill']) {
      expect(keys, `missing scheduler ${k}`).toContain(k)
    }
  })
})
