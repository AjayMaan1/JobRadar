import { Worker } from 'bullmq'
import { boards } from '../context.js'
import { connection, enrichQueue } from '../queues.js'
import { log } from '@jobradar/log'

const POLL_CONCURRENCY = parseInt(process.env.POLL_CONCURRENCY ?? '10')

/** One job per due board (jobId=board:<id> prevents stacking). */
export function startPollBoardWorker(): Worker {
  return new Worker(
    'poll-board',
    async (job) => {
      const { boardId } = job.data as { boardId: string }
      const r = await boards.poll(boardId, 'list')
      for (const e of r.enrich) {
        await enrichQueue.add('enrich', e, { jobId: `enrich--${e.feedKey.replace(/:/g, '_')}--${e.externalId.replace(/:/g, '_')}--${e.event}`.slice(0, 200) })
      }
      if (r.outcome === 'changed') log.info(`[board ${boardId.slice(0, 8)}] +${r.newCount} new · ${r.changedCount} changed · ${r.goneCount} gone · ${r.closedCount} closed`)
      else if (r.outcome !== 'unchanged') log.info(`[board ${boardId.slice(0, 8)}] ${r.outcome}${r.error ? `: ${r.error}` : ''}`)
      return { outcome: r.outcome, new: r.newCount }
    },
    { connection, concurrency: POLL_CONCURRENCY }
  )
}
