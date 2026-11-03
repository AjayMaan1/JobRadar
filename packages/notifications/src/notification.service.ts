import type { PrismaClient, Job } from '@jobradar/db'
import type Redis from 'ioredis'
import { log } from '@jobradar/log'
import { sendOpsTelegram, sendTelegramMessage } from './telegram.js'
import { sendDailyDigest, sendFollowUpEmail, sendMail } from './email.js'
import { formatTelegramAlert } from './templates/job-alert.js'
import { formatDigestEmail } from './templates/daily-digest.js'

export interface AlertOptions {
  /** Board or source key used for the per-feed hourly alert cap. */
  feedKey?: string | null
  score: number
  /** v5: per-user evaluation (userId → tier/score/instant). When present, recipients are matched on THEIR tier. */
  evals?: Map<string, { tier: string; score: number; instant: boolean; label?: string | null; reasons?: string[] }>
  /** The env-configured channel (recipient.userId = null) belongs to the deployment owner. */
  ownerUserId?: string | null
}

/** Legacy class ids on existing alert_channels rows ↔ v5 tier ids. */
const CLASS_TO_TIER: Record<string, string> = { p1_global_remote: 'tier1', p2_india_remote: 'tier2', p3_ncr_hybrid: 'tier3' }
const tierOf = (c: string) => CLASS_TO_TIER[c] ?? c

const ALERT_CAP_PER_FEED_PER_HOUR = parseInt(process.env.ALERT_CAP_PER_FEED_PER_HOUR ?? '10', 10)
const INSTANT_CLASSES = (process.env.INSTANT_ALERT_CLASSES ?? 'p1_global_remote,p2_india_remote').split(',').map((s) => s.trim())

export interface NotificationDeps {
  /** Injectable for tests; defaults to the nodemailer-backed sender. */
  sendDigestEmail?: typeof sendDailyDigest
  sendFollowUpEmail?: typeof sendFollowUpEmail
  /** v5: per-user digest schedule (hour in the user's timezone) from their preferences; null = default 08:00 IST. */
  digestSchedule?: (userId: string) => Promise<{ hour: number; timezone: string } | null>
}

/** Local hour (0–23) of `at` in an IANA zone; falls back to UTC on unknown zones. */
export function localHour(at: Date, timezone: string): number {
  try { return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(at), 10) % 24 } catch { return at.getUTCHours() }
}

/** A delivery target. `userId` is null for the env-configured owner channel (single-user deployments). */
export interface Recipient {
  userId: string | null
  kind: 'telegram' | 'email'
  address: string
  classes: string[]
  minScore: number
  instant: boolean
  digest: boolean
}

/**
 * Alerts & digests. v4 (audit NEW-03 / GH-6): delivery is per recipient. Recipients come from `alert_channels`
 * when any exist; otherwise the TELEGRAM_CHAT_ID / EMAIL_TO env vars form the owner's implicit channel, so a
 * single-user install behaves exactly as before. Dedupe is per (canonical hash, channel, recipient).
 */
export class NotificationService {
  private sendDigestEmail: typeof sendDailyDigest
  private sendFollowUp: typeof sendFollowUpEmail
  private digestSchedule: NotificationDeps['digestSchedule']

  constructor(private prisma: PrismaClient, private redis?: Redis, deps: NotificationDeps = {}) {
    this.sendDigestEmail = deps.sendDigestEmail ?? sendDailyDigest
    this.sendFollowUp = deps.sendFollowUpEmail ?? sendFollowUpEmail
    this.digestSchedule = deps.digestSchedule
  }

  static isInstantClass(cls: string): boolean {
    return INSTANT_CLASSES.includes(cls)
  }

  /**
   * Configured recipients: every enabled alert_channels row, plus the env-configured Telegram/e-mail channel
   * as the deployment owner's implicit channel while the owner has no rows of their own (so adding a channel
   * for a second user never silences the owner; legacy single-user behaviour unchanged).
   */
  async recipients(): Promise<Recipient[]> {
    const rows = await this.prisma.alertChannel.findMany({ where: { enabled: true } })
    const out: Recipient[] = rows.map((r) => ({ userId: r.userId, kind: r.kind as Recipient['kind'], address: r.address, classes: r.classes, minScore: r.minScore, instant: r.instant, digest: r.digest }))
    const owner = await this.ownerUserId()
    const ownerHasRows = owner !== null && rows.some((r) => r.userId === owner)
    if (!ownerHasRows && (rows.length === 0 || owner !== null)) {
      const channels = (process.env.NOTIFICATION_CHANNELS ?? 'telegram').split(',').map((s) => s.trim())
      const userId = rows.length ? owner : null // no rows at all → pure legacy (userId null)
      if (channels.includes('telegram') && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) out.push({ userId, kind: 'telegram', address: process.env.TELEGRAM_CHAT_ID, classes: INSTANT_CLASSES, minScore: 0, instant: true, digest: false })
      if (channels.includes('email') && process.env.SMTP_HOST && process.env.EMAIL_TO) out.push({ userId, kind: 'email', address: process.env.EMAIL_TO, classes: ['p1_global_remote', 'p2_india_remote', 'p3_ncr_hybrid'], minScore: 0, instant: false, digest: true })
    }
    return out
  }

  /**
   * Instant alert for a newly sighted P1/P2 job. Per recipient: dedupes per canonical hash + channel + address,
   * applies the per-feed hourly cap (spillover is recorded as 'deferred' and picked up by the digest), and never
   * marks a notification as sent when the channel is unconfigured.
   */
  async sendInstantAlert(job: Job, opts: AlertOptions): Promise<'sent' | 'deferred' | 'skipped' | 'failed'> {
    const all = (await this.recipients()).filter((r) => r.instant && r.kind === 'telegram')
    const targets = opts.evals
      ? all.filter((r) => {
          const e = opts.evals!.get(r.userId ?? opts.ownerUserId ?? '')
          return Boolean(e && e.instant && r.classes.map(tierOf).includes(e.tier) && e.score >= r.minScore)
        })
      : all.filter((r) => r.classes.includes(job.opportunityClass) && opts.score >= r.minScore)
    if (!targets.length) {
      if (!process.env.TELEGRAM_BOT_TOKEN) log.warn('Telegram not configured — alert not sent, not recorded as sent')
      return 'skipped'
    }
    let result: 'sent' | 'deferred' | 'skipped' | 'failed' = 'skipped'
    for (const t of targets) {
      const r = await this.deliverInstant(job, opts, t)
      // aggregate: any send → sent; else any deferred → deferred; else failed > skipped
      if (r === 'sent') result = 'sent'
      else if (r === 'deferred' && result !== 'sent') result = 'deferred'
      else if (r === 'failed' && result === 'skipped') result = 'failed'
    }
    return result
  }

  private async deliverInstant(job: Job, opts: AlertOptions, t: Recipient): Promise<'sent' | 'deferred' | 'skipped' | 'failed'> {
    const existing = await this.prisma.notification.findFirst({
      where: { canonicalHash: job.canonicalHash, channel: 'telegram', recipient: t.address, notificationType: { in: ['instant', 'deferred'] } },
    })
    if (existing) return 'skipped'

    if (opts.feedKey && this.redis) {
      const hour = new Date().toISOString().slice(0, 13)
      const key = `alerts:cap:${opts.feedKey}:${t.address}:${hour}`
      const n = await this.redis.incr(key)
      if (n === 1) await this.redis.expire(key, 2 * 3600)
      if (n > ALERT_CAP_PER_FEED_PER_HOUR) {
        await this.prisma.notification.create({
          data: { jobId: job.id, channel: 'telegram', recipient: t.address, notificationType: 'deferred', score: opts.score, canonicalHash: job.canonicalHash, status: 'deferred' },
        })
        return 'deferred'
      }
    }

    try {
      const mine = opts.evals?.get(t.userId ?? opts.ownerUserId ?? '')
      await sendTelegramMessage(t.address, formatTelegramAlert(job, mine?.score ?? opts.score, mine ? { tier: mine.tier, label: mine.label, reasons: mine.reasons } : undefined), { markdown: true })
      await this.prisma.notification.create({
        data: { jobId: job.id, channel: 'telegram', recipient: t.address, notificationType: 'instant', score: opts.score, canonicalHash: job.canonicalHash, sentAt: new Date(), status: 'sent' },
      })
      return 'sent'
    } catch (err) {
      await this.prisma.notification.create({
        data: { jobId: job.id, channel: 'telegram', recipient: t.address, notificationType: 'instant', score: opts.score, canonicalHash: job.canonicalHash, sentAt: new Date(), status: 'failed', error: String(err).slice(0, 500) },
      })
      return 'failed'
    }
  }

  /**
   * Daily digest per e-mail recipient: P3 jobs + deferred (capped) P1/P2 + any P1/P2 that never got an instant
   * alert, first seen in the last 24h, not closed, not internship/part-time. Returns jobs delivered (summed).
   */
  async sendDailyDigest(opts: { dueAt?: Date } = {}): Promise<number> {
    let targets = (await this.recipients()).filter((r) => r.digest && r.kind === 'email')
    // v5: the scheduler runs hourly; each recipient is served at THEIR digest hour (preferences.alerts.digestHour
    // in their timezone). Recipients without a document (env fallback) keep the legacy 08:00 IST.
    if (opts.dueAt) {
      const at = opts.dueAt
      const due: typeof targets = []
      for (const t of targets) {
        const sched = t.userId && this.digestSchedule ? await this.digestSchedule(t.userId).catch(() => null) : null
        const hour = sched ? sched.hour : 8
        const tz = sched ? sched.timezone : 'Asia/Kolkata'
        if (localHour(at, tz) === hour) due.push(t)
      }
      targets = due
    }
    if (!targets.length) {
      if (!process.env.SMTP_HOST) log.warn('Email not configured — digest not sent')
      return 0
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    let total = 0
    for (const t of targets) {
      // Exclude jobs already digested to this address in the window AND jobs that already got an instant alert
      // (deferred/capped ones are NOT excluded — the digest is their delivery channel).
      const already = await this.prisma.notification.findMany({
        where: { OR: [{ notificationType: 'digest', recipient: t.address, sentAt: { gte: since } }, { notificationType: 'instant', status: 'sent', ...(t.userId ? { recipient: { in: await this.addressesOf(t.userId) } } : {}) }] },
        select: { jobId: true },
      })
      const exclude = [...new Set(already.map((r) => r.jobId).filter(Boolean) as string[])]
      // v5: the recipient's own evaluations (tiers from their preferences) decide what goes into their digest;
      // the env-configured channel belongs to the deployment owner. Legacy classes when no evals exist.
      const evalUser = t.userId ?? (await this.ownerUserId())
      const useEvals = process.env.PREFS_ENGINE !== 'legacy' && evalUser !== null && (await this.prisma.jobUserEval.count({ where: { userId: evalUser } })) > 0
      const tiers = t.classes.map(tierOf)
      const jobs = await this.prisma.job.findMany({
        where: {
          firstSeenAt: { gte: since },
          closedAt: null,
          status: 'new',
          ...(useEvals
            ? { evals: { some: { userId: evalUser!, tier: { in: tiers.length ? tiers : ['tier1', 'tier2', 'tier3'] }, ...(t.minScore > 0 ? { score: { gte: t.minScore } } : {}) } } }
            : { opportunityClass: { in: t.classes.length ? (t.classes as Job['opportunityClass'][]) : ['p1_global_remote', 'p2_india_remote', 'p3_ncr_hybrid'] }, ...(t.minScore > 0 ? { baseScore: { gte: t.minScore } } : {}) }),
          employmentType: { notIn: ['internship', 'part_time'] },
          ...(exclude.length ? { id: { notIn: exclude } } : {}),
        },
        orderBy: [{ opportunityClass: 'asc' }, { baseScore: 'desc' }, { firstSeenAt: 'desc' }],
        take: 40,
      })
      if (jobs.length === 0) continue
      try {
        await this.sendDigestEmail(jobs, t.address)
        await this.prisma.notification.createMany({
          data: jobs.map((job) => ({ jobId: job.id, channel: 'email', recipient: t.address, notificationType: 'digest', score: job.rankingScore, canonicalHash: job.canonicalHash, sentAt: new Date(), status: 'sent' })),
        })
        total += jobs.length
      } catch (err) {
        log.error('Daily digest failed', err as Error, { recipient: t.address.replace(/(.).+(@.*)/, '$1***$2') })
      }
    }
    return total
  }

  private ownerCache: { at: number; id: string | null } | null = null
  private async ownerUserId(): Promise<string | null> {
    if (this.ownerCache && Date.now() - this.ownerCache.at < 10 * 60_000) return this.ownerCache.id
    const o = await this.prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' }, select: { id: true } }).catch(() => null)
    this.ownerCache = { at: Date.now(), id: o?.id ?? null }
    return this.ownerCache.id
  }

  private async addressesOf(userId: string): Promise<string[]> {
    return (await this.prisma.alertChannel.findMany({ where: { userId }, select: { address: true } })).map((c) => c.address)
  }

  /**
   * Follow-up reminders (GH-5, audit NEW-18): applications whose `followUpAt` is due are announced once to the
   * owner's channels (Telegram if instant-enabled, else e-mail) and an event is appended to the timeline.
   */
  async sendFollowUpReminders(now = new Date()): Promise<number> {
    const due = await this.prisma.application.findMany({
      where: { followUpAt: { lte: now }, status: { in: ['applied', 'interviewing'] } },
      include: { job: { select: { title: true, company: true, applyUrl: true, sourceUrl: true } } },
      take: 200,
    })
    if (!due.length) return 0
    const recipients = await this.recipients()
    let n = 0
    const byUser = new Map<string | null, typeof due>()
    for (const a of due) { const k = a.userId ?? null; byUser.set(k, [...(byUser.get(k) ?? []), a]) }
    for (const [userId, apps] of byUser) {
      const mine = recipients.filter((r) => r.userId === userId || (r.userId === null && recipients.every((x) => x.userId === null)))
      const items = apps.map((a) => ({ title: a.job.title, company: a.job.company, appliedAt: a.appliedAt, url: a.job.applyUrl ?? a.job.sourceUrl }))
      let delivered = false
      for (const r of mine) {
        try {
          if (r.kind === 'telegram') await sendTelegramMessage(r.address, `🔔 Follow-up due (${items.length})\n${items.map((i) => `• ${i.title} @ ${i.company}`).join('\n')}`)
          else await this.sendFollowUp(r.address, items)
          delivered = true
        } catch (err) {
          log.warn('follow-up reminder failed', { kind: r.kind, reason: (err as Error).message })
        }
      }
      if (!delivered && mine.length === 0) log.warn('follow-up due but no alert channel configured', { userId })
      for (const a of apps) {
        const events = [...(((a.events as Array<Record<string, unknown>> | null) ?? [])), { at: now.toISOString(), type: 'follow_up_due', note: delivered ? 'reminder sent' : 'reminder not delivered (no channel)' }]
        await this.prisma.application.update({ where: { id: a.id }, data: { followUpAt: null, events: events as never } })
        n++
      }
    }
    return n
  }

  /** Operator alert (blocked hosts, budget, dispatcher lag). Uses the ops Telegram chat. */
  async sendOpsAlert(text: string): Promise<void> {
    await sendOpsTelegram(text)
  }

  /** Generic transactional e-mail to one user (used by exports, erasure confirmations). */
  async sendUserEmail(to: string, subject: string, text: string): Promise<void> {
    await sendMail(to, subject, text)
  }

  /** Digest preview text for the UI ("what would I get today?"). */
  previewDigest(jobs: Job[]): { subject: string; text: string } {
    const { subject, text } = formatDigestEmail(jobs)
    return { subject, text }
  }
}

/**
 * Deduped ops alerts (audit NEW-05): `alert('worker-down', text)` fires at most once per `everySec` per key,
 * from any process (web or worker), backed by Redis with an in-memory fallback.
 */
export class OpsAlerter {
  private memory = new Map<string, number>()
  constructor(private redis: Pick<Redis, 'set'> | null, private everySec = 3600) {}
  async alert(key: string, text: string): Promise<boolean> {
    const k = `ops:alert:${key}`
    try {
      if (this.redis) {
        const r = await (this.redis as Redis).set(k, '1', 'EX', this.everySec, 'NX')
        if (r !== 'OK') return false
      } else {
        const last = this.memory.get(k) ?? 0
        if (Date.now() - last < this.everySec * 1000) return false
        this.memory.set(k, Date.now())
      }
    } catch {
      const last = this.memory.get(k) ?? 0
      if (Date.now() - last < this.everySec * 1000) return false
      this.memory.set(k, Date.now())
    }
    return sendOpsTelegram(text)
  }
}
