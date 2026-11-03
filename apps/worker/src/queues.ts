import { Queue, type JobsOptions } from 'bullmq'
import Redis from 'ioredis'

const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
export const redis = new Redis(url, { maxRetriesPerRequest: null })
export const connection = { url }

const defaultJobOptions: JobsOptions = {
  removeOnComplete: 200,
  removeOnFail: 1000,
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
}

export const crawlQueue = new Queue('crawl', { connection, defaultJobOptions })
export const pollBoardQueue = new Queue('poll-board', { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 1 } })
export const enrichQueue = new Queue('enrich', { connection, defaultJobOptions })
export const discoveryQueue = new Queue('discovery', { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 2 } })
export const notifyQueue = new Queue('notify', { connection, defaultJobOptions })
export const maintenanceQueue = new Queue('maintenance', { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 1 } })

// v3 (resume / match). User-facing tasks: fail fast, no long retry ladders — the UI polls the task state.
const userTaskOptions: JobsOptions = { removeOnComplete: 100, removeOnFail: 200, attempts: 2, backoff: { type: 'fixed', delay: 5_000 } }
export const resumeParseQueue = new Queue('resume-parse', { connection, defaultJobOptions: userTaskOptions })
export const jdAnalyzeQueue = new Queue('jd-analyze', { connection, defaultJobOptions: userTaskOptions })
export const atsScoreQueue = new Queue('ats-score', { connection, defaultJobOptions: userTaskOptions })
export const suggestQueue = new Queue('suggest', { connection, defaultJobOptions: userTaskOptions })
export const resumeRenderQueue = new Queue('resume-render', { connection, defaultJobOptions: userTaskOptions })
/** C13: embeddings + fit computation (cheap, CPU-light; runs alongside the single LLM lane). */
export const embedQueue = new Queue('embed', { connection, defaultJobOptions: { ...userTaskOptions, attempts: 3 } })
/** v5: re-evaluate one user's open jobs after a preference change (idempotent per version). */
export const prefsReevalQueue = new Queue('prefs-reeval', { connection, defaultJobOptions: { ...userTaskOptions, attempts: 2 } })

export const QUEUES = { crawlQueue, pollBoardQueue, enrichQueue, discoveryQueue, notifyQueue, maintenanceQueue, resumeParseQueue, jdAnalyzeQueue, atsScoreQueue, suggestQueue, resumeRenderQueue, embedQueue, prefsReevalQueue }

export async function closeQueues(): Promise<void> {
  await Promise.all(Object.values(QUEUES).map((q) => q.close()))
  redis.disconnect()
}
