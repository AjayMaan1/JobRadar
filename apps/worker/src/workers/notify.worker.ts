import { Worker } from 'bullmq'
import { prisma, notifications } from '../context.js'
import { connection } from '../queues.js'
import { log } from '@jobradar/log'

export function startNotifyWorker(): Worker {
  return new Worker(
    'notify',
    async (job) => {
      if (job.data.type === 'digest') {
        const n = await notifications.sendDailyDigest({ dueAt: new Date() })
        log.info(`Daily digest: ${n} jobs`)
        return { sent: n }
      }
      if (job.data.type === 'instant') {
        const { jobId, score, feedKey } = job.data as { jobId: string; score: number; feedKey?: string }
        const dbJob = await prisma.job.findUnique({ where: { id: jobId } })
        if (dbJob) return notifications.sendInstantAlert(dbJob, { score, feedKey: feedKey ?? null })
      }
    },
    { connection, concurrency: 1 }
  )
}
