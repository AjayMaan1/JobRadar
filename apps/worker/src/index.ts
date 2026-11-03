import 'dotenv/config'
import type { Worker } from 'bullmq'
import { setupSchedules } from './scheduler.js'
import { startCrawlWorker } from './workers/crawl.worker.js'
import { startPollBoardWorker } from './workers/poll-board.worker.js'
import { startEnrichWorker } from './workers/enrich.worker.js'
import { startDiscoveryWorker } from './workers/discovery.worker.js'
import { startMaintenanceWorker } from './workers/maintenance.worker.js'
import { startNotifyWorker } from './workers/notify.worker.js'
import { startAtsScoreWorker, startEmbedWorker, startJdAnalyzeWorker, startResumeParseWorker, startResumeRenderWorker, startSuggestWorker } from './workers/resume.worker.js'
import { startPrefsReevalWorker } from './workers/prefs.worker.js'
import { closeQueues } from './queues.js'
import { CRAWLER_CONFIG } from '@jobradar/crawler'
import { log } from '@jobradar/log'
import { describeLlm } from '@jobradar/llm'
import { instrument, startHeartbeat, startOpsServer } from './ops.js'

process.env.APP_NAME ??= 'worker'

async function main() {
  log.info('Starting JobRadar worker', { userAgent: CRAWLER_CONFIG.userAgent, version: process.env.APP_VERSION ?? 'dev' })
  const { llm, store, embeddingProvider, prisma, preferences } = await import('./context.js')
  // v5: system presets come from code; the owner's doc is seeded from the legacy env on first run.
  await preferences.ensureSystemPresets().catch((err) => log.warn('system presets not seeded', { reason: (err as Error).message }))
  const owner = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' }, select: { id: true } })
  if (owner) await preferences.ensure(owner.id).catch((err) => log.warn('owner preferences not seeded', { reason: (err as Error).message }))
  log.info('providers', { llm: llm?.name ?? 'none (deterministic only)', embeddings: embeddingProvider ? `${embeddingProvider.name}/${embeddingProvider.model}` : 'none', storage: store.driver })
  if (llm) {
    // docs/AI-PROVIDERS.md §5: one line per configured provider — reachability, data-use class, PII eligibility
    const st = await describeLlm().catch(() => null)
    for (const p of st?.providers ?? []) {
      const line = `AI provider ${p.name} (${p.kind}${p.model ? `, ${p.model}` : ''}) · ${p.dataUse}${p.piiAllowed ? '' : ' · public inputs only'}${p.quota?.rpd ? ` · free tier ${p.quota.rpd} req/day` : ''}`
      if (p.reachable === false) log.warn(`${line} — ${p.detail ?? 'not reachable'}${st!.providers.length > 1 ? ' (chain falls back)' : ' (deterministic features keep working)'}`)
      else log.info(line)
    }
  }
  // Multi-user sanity (audit NEW-03): alerts/ranking are per-user only through alert_channels / job_fits.
  if (process.env.ALLOW_SIGNUP === 'true') {
    const [users, channels] = await Promise.all([prisma.user.count(), prisma.alertChannel.count()])
    if (users > 1 && channels === 0) log.warn('ALLOW_SIGNUP=true with several users but no alert_channels rows: the env Telegram/e-mail channel receives every user\'s alerts. Configure per-user channels under Profile → Alerts.')
  }

  const stopHeartbeat = startHeartbeat()
  const stopOps = startOpsServer()
  await setupSchedules()

  const workers: Worker[] = [
    startMaintenanceWorker(),
    startPollBoardWorker(),
    startEnrichWorker(),
    startCrawlWorker(),
    startDiscoveryWorker(),
    startNotifyWorker(),
    startResumeParseWorker(),
    startJdAnalyzeWorker(),
    startAtsScoreWorker(),
    startSuggestWorker(),
    startResumeRenderWorker(),
    startEmbedWorker(),
    startPrefsReevalWorker(),
  ]
  instrument(workers)

  let shuttingDown = false
  async function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    log.info('Shutting down workers', { signal })
    stopHeartbeat()
    stopOps()
    const forceExit = setTimeout(() => { log.error('shutdown timed out — exiting'); process.exit(1) }, 30_000)
    forceExit.unref()
    await Promise.all(workers.map((w) => w.close()))
    const { pdfRenderer } = await import('./context.js')
    await pdfRenderer.close()
    await closeQueues()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason instanceof Error ? reason : new Error(String(reason))))
  process.on('uncaughtException', (err) => { log.error('uncaught exception — exiting', err); void shutdown('uncaughtException') })

  log.info('Worker running. Waiting for jobs...')
}

main().catch((err) => {
  log.error('Worker startup failed', err as Error)
  process.exit(1)
})
