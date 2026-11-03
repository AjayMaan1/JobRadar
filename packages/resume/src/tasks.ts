import { randomUUID } from 'node:crypto'
import type Redis from 'ioredis'

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed'

export interface TaskState<R = unknown> {
  id: string
  type: string
  userId: string | null
  status: TaskStatus
  progress: string | null
  result: R | null
  error: string | null
  createdAt: string
  updatedAt: string
}

const TTL = 24 * 3600

/**
 * Enqueue-and-poll bookkeeping (HLD V8): web creates a task, worker updates it, UI polls GET /api/tasks/:id.
 * Backed by Redis, or by process memory when constructed with `null` (QUEUE_MODE=inline — no Redis at all).
 */
export class TaskTracker {
  private memory = new Map<string, { raw: string; exp: number }>()
  constructor(private redis: Redis | null) {}

  private key(id: string) { return `task:${id}` }

  private async put(id: string, t: TaskState): Promise<void> {
    if (this.redis) { await this.redis.setex(this.key(id), TTL, JSON.stringify(t)); return }
    this.memory.set(id, { raw: JSON.stringify(t), exp: Date.now() + TTL * 1000 })
    if (this.memory.size > 5000) for (const [k, v] of this.memory) if (v.exp < Date.now()) this.memory.delete(k)
  }

  async create(type: string, userId: string | null, id = randomUUID()): Promise<TaskState> {
    const now = new Date().toISOString()
    const t: TaskState = { id, type, userId, status: 'queued', progress: null, result: null, error: null, createdAt: now, updatedAt: now }
    await this.put(id, t)
    return t
  }

  async get<R = unknown>(id: string): Promise<TaskState<R> | null> {
    if (this.redis) {
      const raw = await this.redis.get(this.key(id))
      return raw ? (JSON.parse(raw) as TaskState<R>) : null
    }
    const m = this.memory.get(id)
    if (!m || m.exp < Date.now()) return null
    return JSON.parse(m.raw) as TaskState<R>
  }

  async update(id: string, patch: Partial<Pick<TaskState, 'status' | 'progress' | 'result' | 'error'>>): Promise<void> {
    const cur = await this.get(id)
    if (!cur) return
    await this.put(id, { ...cur, ...patch, updatedAt: new Date().toISOString() })
  }

  async running(id: string, progress?: string) { await this.update(id, { status: 'running', progress: progress ?? null }) }
  async done(id: string, result: unknown) { await this.update(id, { status: 'done', result, progress: null }) }
  async failed(id: string, error: string) { await this.update(id, { status: 'failed', error }) }
}
