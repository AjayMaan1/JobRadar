import { prisma } from '@jobradar/db'
import { CrawlerService, FetchGateway } from '@jobradar/crawler'
import {
  BoardPollService, EnrichService, DiscoveryService, ResolverService, ProberService,
  TieringService, DispatcherService, LivenessService, RetentionService, HealthService, SightingService,
} from '@jobradar/watchlist'
import { NotificationService } from '@jobradar/notifications'
import { RankingService } from '@jobradar/ranking'
import { createEmbeddingProvider, createLlmProvider } from '@jobradar/llm'
import { createObjectStore } from '@jobradar/storage'
import { AnalysisService, ApplyKitService, ErasureService, PlaywrightPdfRenderer, ResumeService, SemanticService, SuggestionService, TaskTracker, VersionService } from '@jobradar/resume'
import { JdHydrationService, type JobEvaluator } from '@jobradar/watchlist'
import { CrawlScopeService, EvalService, PreferencesService, instantTierIds } from '@jobradar/prefs'
import { redis } from './queues.js'

/** One set of service instances per worker process. */
export const gateway = new FetchGateway(prisma, redis)
export const crawler = new CrawlerService(redis, prisma, gateway)
export const boards = new BoardPollService(prisma, gateway)

// v5 dynamic preferences: per-user evaluation of every job; crawl policy = union of users' preferences.
export const preferences = new PreferencesService(prisma)
export const evals = new EvalService(prisma, { activeDays: parseInt(process.env.PREFS_ACTIVE_DAYS ?? '90', 10) })
export const crawlScope = new CrawlScopeService(prisma, evals)
let ownerCache: { at: number; id: string | null } | null = null
const evaluator: JobEvaluator = {
  evaluateJob: (job) => evals.evaluateJob(job),
  instantTiers: async (userId) => { const u = (await evals.activeUsers()).find((x) => x.userId === userId); return u ? instantTierIds(u.prefs) : new Set() },
  ownerUserId: async () => {
    if (ownerCache && Date.now() - ownerCache.at < 10 * 60_000) return ownerCache.id
    const o = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    ownerCache = { at: Date.now(), id: o?.id ?? null }
    return ownerCache.id
  },
}
export const enricher = new EnrichService(prisma, redis, gateway, evaluator)
export const discovery = new DiscoveryService(prisma)
export const resolver = new ResolverService(prisma, gateway)
export const prober = new ProberService(prisma, gateway)
export const tiering = new TieringService(prisma, crawlScope)
export const dispatcher = new DispatcherService(prisma)
export const liveness = new LivenessService(prisma, gateway)
export const store = createObjectStore()
/** Lifecycle hooks (audit NEW-01/NEW-08): vectors and files are removed together with their owners. */
export const erasure = new ErasureService(prisma, store)
export const retention = new RetentionService(prisma, store, erasure)
export const health = new HealthService(prisma)
export const sightings = new SightingService(prisma)
export const notifications = new NotificationService(prisma, redis, {
  // v5: digest at the user's own hour/timezone (preferences.alerts.digestHour)
  digestSchedule: async (userId) => {
    const u = (await evals.activeUsers()).find((x) => x.userId === userId)
    return u ? { hour: u.prefs.alerts.digestHour, timezone: u.prefs.home.timezone } : null
  },
})
export const ranking = new RankingService(prisma)

// v3: resume / match services. LLM may be null (LLM_PROVIDER=none) → deterministic-only behaviour.
export const llm = createLlmProvider({ redis })
export const tasks = new TaskTracker(redis)
export const hydrator = new JdHydrationService(prisma, gateway)
export const resumes = new ResumeService(prisma, store)
// C13: local embeddings (Ollama nomic-embed-text by default); null → keyword-only behaviour everywhere.
export const embeddingProvider = createEmbeddingProvider()
export const semantic = embeddingProvider ? new SemanticService(prisma, embeddingProvider) : null
export const analysis = new AnalysisService(prisma, { llm, hydrator, semantic })
export const suggestions = new SuggestionService(prisma, { llm })
/** Shared Chromium for PDF rendering (C3-7/C9). Launched lazily; closed on shutdown. */
export const pdfRenderer = new PlaywrightPdfRenderer({ maxConcurrent: parseInt(process.env.RENDER_CONCURRENCY ?? '2', 10) })
export const versions = new VersionService(prisma, store, { pdf: pdfRenderer, analysis })
export const applyKit = new ApplyKitService(prisma, store, { llm, hydrator })
export { prisma, redis }
