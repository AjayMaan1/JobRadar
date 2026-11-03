import { createServer } from 'node:http'
import type { Worker } from 'bullmq'
import { log, metrics, m } from '@jobradar/log'
import { redis, QUEUES } from './queues.js'

const VERSION = process.env.APP_VERSION ?? process.env.GIT_SHA ?? 'dev'
const HEARTBEAT_EVERY_MS = parseInt(process.env.WORKER_HEARTBEAT_MS ?? '30000', 10)
/** Last successful heartbeat (unix seconds) — drives /healthz. */
let lastBeatTs = 0

/**
 * Worker liveness (audit NEW-05): a plain setInterval (not a queue job) writes `worker:heartbeat` so the web tier
 * can tell "process alive but queues wedged" from "process dead". `/api/health` raises the alarm.
 */
export function startHeartbeat(): () => void {
  const beat = async () => {
    try {
      await redis.set('worker:heartbeat', JSON.stringify({ at: new Date().toISOString(), version: VERSION, pid: process.pid }), 'EX', Math.ceil((HEARTBEAT_EVERY_MS * 6) / 1000))
      lastBeatTs = Math.floor(Date.now() / 1000)
      m.workerHeartbeat.set(lastBeatTs)
    } catch (err) {
      log.warn('heartbeat write failed', { reason: (err as Error).message })
    }
  }
  void beat()
  const t = setInterval(beat, HEARTBEAT_EVERY_MS)
  t.unref()
  return () => clearInterval(t)
}

/** Count outcomes + durations for every BullMQ worker (one place, all queues). */
export function instrument(workers: Worker[]): void {
  for (const w of workers) {
    const l = log.child({ queue: w.name })
    w.on('completed', (job) => {
      m.queueJobs.inc({ queue: w.name, outcome: 'completed' })
      if (job?.processedOn && job.finishedOn) m.queueDuration.observe({ queue: w.name }, (job.finishedOn - job.processedOn) / 1000)
    })
    w.on('failed', (job, err) => {
      m.queueJobs.inc({ queue: w.name, outcome: 'failed' })
      l.error('job failed', { job: job?.name, id: job?.id, attempts: job?.attemptsMade, reason: err.message })
    })
    w.on('error', (err) => { m.queueJobs.inc({ queue: w.name, outcome: 'error' }); l.error('worker error', err) })
    w.on('stalled', (id) => { m.queueJobs.inc({ queue: w.name, outcome: 'stalled' }); l.warn('job stalled', { id }) })
  }
  m.queueDepth.collect(async () => {
    for (const q of Object.values(QUEUES)) {
      const c = await q.getJobCounts('waiting', 'active', 'failed', 'delayed')
      for (const [state, n] of Object.entries(c)) m.queueDepth.set({ queue: q.name, state }, n)
    }
  })
}

/**
 * Tiny HTTP endpoint for scrapers and process managers: GET /metrics (Prometheus), GET /healthz (200 when the
 * heartbeat loop is running and Redis answered within the last two beats). Bound to localhost by default.
 */
export function startOpsServer(): () => void {
  const port = parseInt(process.env.WORKER_METRICS_PORT ?? '9464', 10)
  const host = process.env.WORKER_METRICS_HOST ?? '127.0.0.1'
  if (!port) return () => undefined
  const server = createServer(async (req, res) => {
    if (req.url === '/metrics') {
      const body = await metrics.expose()
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
      res.end(body)
      return
    }
    if (req.url === '/healthz') {
      const agoSec = Math.round(Date.now() / 1000 - lastBeatTs)
      const fresh = lastBeatTs > 0 && agoSec < (HEARTBEAT_EVERY_MS * 2) / 1000
      res.writeHead(fresh ? 200 : 503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: fresh, version: VERSION, uptimeSec: Math.round(process.uptime()), lastHeartbeatAgoSec: agoSec }))
      return
    }
    res.writeHead(404); res.end()
  })
  server.listen(port, host, () => log.info('ops endpoint listening', { host, port, routes: ['/metrics', '/healthz'] }))
  server.on('error', (err) => log.warn('ops endpoint unavailable', { reason: (err as Error).message }))
  return () => server.close()
}

