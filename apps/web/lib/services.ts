import Redis from 'ioredis'
import { Queue } from 'bullmq'
import { NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { createObjectStore } from '@jobradar/storage'
import { AnalysisService, ApplyKitService, JobVectorIndex, ResumeService, SuggestionService, TaskTracker, VersionService } from '@jobradar/resume'
import { createEmbeddingProvider, type EmbeddingProvider } from '@jobradar/llm'
import { CrawlScopeService, EvalService, PreferencesService } from '@jobradar/prefs'
import { withTimeout, log } from '@jobradar/log'
import { InlineRunner, type InlineQueue } from './inline-runner'

/** Process-wide singletons for route handlers (Next.js may re-evaluate modules in dev; guard with globalThis). */
type AnyQueue = Pick<Queue, 'add'> | InlineQueue

type Bag = {
  /** 'bullmq' (worker + Redis) or 'inline' (no Redis; handlers run in this process). */
  mode: 'bullmq' | 'inline'
  redis: Redis
  store: ReturnType<typeof createObjectStore>
  tasks: TaskTracker
  resumes: ResumeService
  analysis: AnalysisService
  suggestions: SuggestionService
  versions: VersionService
  applyKit: ApplyKitService
  /** v5 dynamic preferences (read/write docs, preview; re-evaluation runs in the worker or inline). */
  preferences: PreferencesService
  evals: EvalService
  crawlScope: CrawlScopeService
  queues: { resumeParse: AnyQueue; jdAnalyze: AnyQueue; atsScore: AnyQueue; suggest: AnyQueue; resumeRender: AnyQueue; embed: AnyQueue; prefsReeval: AnyQueue }
  /** BullMQ queue handles for health counters (null in inline mode). */
  bullQueues: Queue[] | null
  inline: InlineRunner | null
  /** C13: query embedding (fast, ~50 ms locally) + in-process job vector index for hybrid search. */
  embeddings: EmbeddingProvider | null
  vectorIndex: JobVectorIndex | null
}
const g = globalThis as unknown as { __jobradarServices?: Bag }

export function services(): Bag {
  if (g.__jobradarServices) return g.__jobradarServices
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  // Web-side Redis must fail fast: a Redis outage should surface as an error, never a hung request.
  const failFast = { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000 }
  const redis = new Redis(url, { ...failFast, lazyConnect: true })
  redis.on('error', (err) => log.warn('[redis] web client error', { reason: err.message }))
  const connection = { url, ...failFast }
  const store = createObjectStore()
  const mode: Bag['mode'] = process.env.QUEUE_MODE === 'inline' ? 'inline' : 'bullmq'
  const tasks = new TaskTracker(mode === 'inline' ? null : redis)
  const inline = mode === 'inline' ? new InlineRunner(tasks, store) : null
  if (inline) log.warn('[queues] QUEUE_MODE=inline — background work runs inside the web process (no Redis/worker)')
  const q = (name: string) => (inline ? inline.queue(name) : new Queue(name, { connection }))
  const bag: Bag = {
    mode,
    redis,
    store,
    tasks,
    inline,
    resumes: new ResumeService(prisma, store),
    // Web never calls the LLM or the crawler gateway — those run in the worker. This instance only reads reports.
    analysis: new AnalysisService(prisma, { llm: null, hydrator: null }),
    suggestions: new SuggestionService(prisma, { llm: null }),              // reads + accept/reject/edit + confirm (no LLM in web)
    versions: new VersionService(prisma, store, { pdf: null, analysis: new AnalysisService(prisma, { llm: null, hydrator: null }) }), // create + read; render runs in the worker
    applyKit: new ApplyKitService(prisma, store, { llm: null, hydrator: null }),
    preferences: new PreferencesService(prisma),
    evals: new EvalService(prisma),
    crawlScope: null as unknown as CrawlScopeService,
    queues: {
      resumeParse: q('resume-parse'),
      jdAnalyze: q('jd-analyze'),
      atsScore: q('ats-score'),
      suggest: q('suggest'),
      resumeRender: q('resume-render'),
      embed: q('embed'),
      prefsReeval: q('prefs-reeval'),
    },
    bullQueues: null,
    embeddings: null,
    vectorIndex: null,
  }
  bag.crawlScope = new CrawlScopeService(prisma, bag.evals)
  try {
    bag.embeddings = createEmbeddingProvider()
    if (bag.embeddings) bag.vectorIndex = new JobVectorIndex(prisma, bag.embeddings.model, parseInt(process.env.VECTOR_INDEX_REFRESH_MS ?? '60000', 10))
  } catch (err) {
    log.warn('[semantic] embeddings disabled', { reason: (err as Error).message })
  }
  if (mode === 'bullmq') bag.bullQueues = Object.values(bag.queues) as Queue[]
  g.__jobradarServices = bag
  return bag
}

/** Map queue back-pressure (inline queue full, Redis down) to a 503 with retry-after (audit NEW-13). */
export function queueErrorResponse(err: unknown): NextResponse | null {
  const e = err as { code?: string; message?: string }
  if (e?.code === 'queue_full') return NextResponse.json({ error: e.message, code: 'queue_full' }, { status: 503, headers: { 'retry-after': '60' } })
  if (typeof e?.message === 'string' && /ECONNREFUSED|Connection is closed|enableOfflineQueue|redis/i.test(e.message)) return NextResponse.json({ error: 'Background queue unavailable — try again shortly', code: 'queue_unavailable' }, { status: 503, headers: { 'retry-after': '30' } })
  return null
}

export const USER_TASK_OPTS = { removeOnComplete: 100, removeOnFail: 200, attempts: 2, backoff: { type: 'fixed' as const, delay: 5_000 } }

/**
 * Semantic candidates for a search query: top-k job ids by cosine. Returns null (→ exact search only) when
 * embeddings are off or Ollama doesn't answer within the timeout — search must never hang on the model.
 */
export async function semanticCandidates(q: string, k = 150): Promise<Array<{ jobId: string; score: number }> | null> {
  const { embeddings, vectorIndex } = services()
  if (!embeddings || !vectorIndex) return null
  try {
    const [vec] = await withTimeout(embeddings.embed([q]), 3000, 'query embedding')
    await withTimeout(vectorIndex.refresh(), 3000, 'vector index refresh')
    if (!vectorIndex.size) return null
    return vectorIndex.search(vec, k)
  } catch (err) {
    log.warn('[semantic] query embedding unavailable', { reason: (err as Error).message })
    return null
  }
}
