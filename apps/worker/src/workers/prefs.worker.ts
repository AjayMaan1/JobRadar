import { Worker } from 'bullmq'
import { log } from '@jobradar/log'
import { connection } from '../queues.js'
import { crawlScope, evals, tasks } from '../context.js'

export interface PrefsReevalPayload { taskId?: string; userId: string; version: number }

/**
 * prefs-reeval (HLD dynamic preferences §7): after a user saves preferences, re-evaluate their open jobs in
 * batches. Idempotent by version; a newer save supersedes a running one. Single-user installs also apply
 * crawl-scope suggestions automatically (decision 5).
 */
export function startPrefsReevalWorker(): Worker<PrefsReevalPayload> {
  return new Worker<PrefsReevalPayload>(
    'prefs-reeval',
    async (job) => {
      const { taskId, userId, version } = job.data
      const l = log.child({ queue: 'prefs-reeval', userId, version })
      if (taskId) await tasks.running(taskId, 'Re-evaluating your jobs')
      evals.invalidateUsers()
      try {
        const r = await evals.reevaluateUser(userId, version, { onProgress: async (done, total) => { if (taskId) await tasks.running(taskId, `Re-evaluated ${done} of ${total} open jobs`) } })
        const applied = await crawlScope.autoApplyIfSingleUser().catch(() => 0)
        if (taskId) await tasks.done(taskId, { evaluated: r.evaluated, superseded: r.skipped, crawlScopeApplied: applied })
        l.info('re-evaluation finished', { evaluated: r.evaluated, superseded: r.skipped, crawlScopeApplied: applied })
        return r
      } catch (err) {
        if (taskId) await tasks.failed(taskId, (err as Error).message)
        throw err
      }
    },
    { connection, concurrency: 1 },
  )
}
