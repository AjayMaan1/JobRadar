import { Worker } from 'bullmq'
import { log } from '@jobradar/log'
import { dispatcher, prober, resolver, tiering, liveness, retention, health, notifications } from '../context.js'
import { connection, pollBoardQueue, enrichQueue } from '../queues.js'
import { syncSourceSchedules } from '../scheduler.js'

export function startMaintenanceWorker(): Worker {
  return new Worker(
    'maintenance',
    async (job) => {
      switch (job.data.type) {
        case 'dispatch': {
          const ids = await dispatcher.claimDue()
          for (const id of ids) await pollBoardQueue.add('poll-board', { boardId: id }, { jobId: `board--${id}` })
          if (ids.length) log.debug('[dispatch] boards due', { count: ids.length })
          return { dispatched: ids.length }
        }
        case 'probe-sweep': {
          const ids = await prober.pendingBoards(50)
          let enq = 0
          for (const id of ids) {
            const r = await prober.probeBoard(id)
            for (const e of r.enrich) {
              await enrichQueue.add('enrich', e, { jobId: `enrich--${e.feedKey.replace(/:/g, '_')}--${e.externalId.replace(/:/g, '_')}--probe`.slice(0, 200) })
              enq++
            }
            log.info('[probe] board probed', { boardId: id, outcome: r.outcome, items: r.enrich.length })
          }
          return { probed: ids.length, enqueued: enq }
        }
        case 'resolve-sweep': {
          const r = await resolver.resolvePending(100)
          if (r.resolved || r.noAts || r.rejected) log.info('[resolve] sweep', r)
          return r
        }
        case 'tiering': {
          const r = await tiering.run()
          log.info('[tiering] done', { companies: r.companies, changed: r.changed })
          return r
        }
        case 'liveness': {
          const r = await liveness.run()
          log.info('[liveness] done', { checked: r.checked, closed: r.closed, agedOut: r.agedOut })
          return r
        }
        case 'retention': {
          const r = await retention.run()
          log.info('[retention] done', r)
          return r
        }
        case 'follow-ups': {
          const n = await notifications.sendFollowUpReminders()
          if (n) log.info('[follow-ups] reminders sent', { applications: n })
          return { reminded: n }
        }
        case 'health': {
          const alerts = await health.alerts()
          const lag = await dispatcher.lagSeconds()
          if (lag > 120) alerts.push(`dispatcher lag ${Math.round(lag)}s`)
          if (alerts.length) {
            log.warn('[health] alerts', { alerts })
            await notifications.sendOpsAlert(alerts.join('\n'))
          }
          return { alerts }
        }
        case 'sync-schedules': {
          return syncSourceSchedules()
        }
        default:
          return
      }
    },
    { connection, concurrency: 2 }
  )
}
