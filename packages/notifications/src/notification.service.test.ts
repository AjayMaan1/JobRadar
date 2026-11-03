import { describe, expect, it, beforeEach } from 'vitest'
import { NotificationService } from './notification.service.js'
import { createFakePrisma } from '../../../tools/testkit/fake-prisma.js'
import { FakeRedis } from '../../../tools/testkit/fake-redis.js'
import { FakeFetch } from '../../../tools/testkit/fake-fetch.js'

let prisma: any, redis: FakeRedis, http: FakeFetch, svc: NotificationService
const mkJob = (i: number, o: Record<string, unknown> = {}) => prisma.job.create({ data: { title: `Job ${i}`, company: 'Acme', sourceName: 's', skills: '[]', canonicalHash: `h${i}`, opportunityClass: 'p1_global_remote', employmentType: 'full_time', applyUrl: `https://a/${i}`, ...o } })

beforeEach(() => {
  prisma = createFakePrisma(); redis = new FakeRedis(); http = new FakeFetch().install()
  http.route(/api\.telegram\.org/, { status: 200, body: { ok: true } })
  process.env.TELEGRAM_BOT_TOKEN = 't'; process.env.TELEGRAM_CHAT_ID = 'c'; process.env.NOTIFICATION_CHANNELS = 'telegram,email'
  svc = new NotificationService(prisma, redis as any, { sendDigestEmail: async () => {} })
})

describe('NotificationService', () => {
  it('instant classes are P1+P2 (P2 instant per decision)', () => {
    expect(NotificationService.isInstantClass('p1_global_remote')).toBe(true)
    expect(NotificationService.isInstantClass('p2_india_remote')).toBe(true)
    expect(NotificationService.isInstantClass('p3_ncr_hybrid')).toBe(false)
  })
  it('sends once per canonical hash', async () => {
    const j = await mkJob(1)
    expect(await svc.sendInstantAlert(j, { score: 80, feedKey: 'f' })).toBe('sent')
    expect(await svc.sendInstantAlert(j, { score: 80, feedKey: 'f' })).toBe('skipped')
    expect(http.requests.length).toBe(1)
  })
  it('caps at 10 per feed per hour and defers the rest', async () => {
    const results: string[] = []
    for (let i = 0; i < 12; i++) results.push(await svc.sendInstantAlert(await mkJob(i), { score: 80, feedKey: 'board:x' }))
    expect(results.filter((r) => r === 'sent').length).toBe(10)
    expect(results.filter((r) => r === 'deferred').length).toBe(2)
    // another feed has its own budget
    expect(await svc.sendInstantAlert(await mkJob(99), { score: 80, feedKey: 'board:y' })).toBe('sent')
  })
  it('does not record "sent" when Telegram is unconfigured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    expect(await svc.sendInstantAlert(await mkJob(5), { score: 80 })).toBe('skipped')
    expect(await prisma.notification.count({})).toBe(0)
  })
  it('message carries the class tag and strips markdown-breaking characters', async () => {
    const j = await mkJob(7, { title: 'Eng_[core]*', classReason: 'india-ok: *worldwide*' })
    await svc.sendInstantAlert(j, { score: 70 })
    const text = JSON.parse(http.requests[0].body!).text as string
    expect(text).toContain('[P1] Global remote')
    expect(text).not.toMatch(/Eng_\[core\]\*/)
    expect(text).toContain('Eng core')
  })
  it('digest includes P3 + deferred, excludes instant-sent and internships', async () => {
    process.env.SMTP_HOST = 'x'; process.env.SMTP_USER = 'u'; process.env.EMAIL_TO = 'e'
    const sentJob = await mkJob(1)
    await svc.sendInstantAlert(sentJob, { score: 80 })
    await mkJob(2, { opportunityClass: 'p3_ncr_hybrid' })
    await mkJob(3, { employmentType: 'internship' })
    const deferred = await mkJob(4)
    await prisma.notification.create({ data: { jobId: deferred.id, channel: 'telegram', notificationType: 'deferred', status: 'deferred', canonicalHash: 'h4' } })
    expect(await svc.sendDailyDigest()).toBe(2)
    expect(await svc.sendDailyDigest()).toBe(0) // already digested
  })
})

describe('NotificationService · per-user channels (audit NEW-03 / GH-6)', () => {
  it('uses alert_channels when present: class + minScore filters, per-recipient dedupe, env channel ignored', async () => {
    const u1 = await prisma.user.create({ data: { email: 'a@x' } })
    const u2 = await prisma.user.create({ data: { email: 'b@x' } })
    await prisma.alertChannel.create({ data: { userId: u1.id, kind: 'telegram', address: 'chat-1', classes: ['p1_global_remote'], minScore: 0 } })
    await prisma.alertChannel.create({ data: { userId: u2.id, kind: 'telegram', address: 'chat-2', classes: ['p1_global_remote', 'p2_india_remote'], minScore: 90 } })
    const j = await mkJob(1)
    expect(await svc.sendInstantAlert(j, { score: 80, feedKey: 'f' })).toBe('sent')
    expect(http.requests.length).toBe(1) // only chat-1 (chat-2 needs ≥ 90); env TELEGRAM_CHAT_ID not used
    expect(JSON.parse(http.requests[0].body!).chat_id).toBe('chat-1')
    expect(await svc.sendInstantAlert(j, { score: 80, feedKey: 'f' })).toBe('skipped')
    const j2 = await mkJob(2, { opportunityClass: 'p2_india_remote' })
    expect(await svc.sendInstantAlert(j2, { score: 95, feedKey: 'f' })).toBe('sent')
    expect(JSON.parse(http.requests[1].body!).chat_id).toBe('chat-2')
    expect(await prisma.notification.count({ where: { recipient: 'chat-2' } })).toBe(1)
  })
  it('follow-up reminders: due applications are announced once and the timeline records it', async () => {
    const u = await prisma.user.create({ data: { email: 'a@x' } })
    await prisma.alertChannel.create({ data: { userId: u.id, kind: 'telegram', address: 'chat-1' } })
    const j = await mkJob(1)
    const app = await prisma.application.create({ data: { userId: u.id, jobId: j.id, status: 'applied', appliedAt: new Date(), followUpAt: new Date(Date.now() - 1000) } })
    await prisma.application.create({ data: { userId: u.id, jobId: (await mkJob(2)).id, status: 'applied', followUpAt: new Date(Date.now() + 86400_000) } })
    expect(await svc.sendFollowUpReminders()).toBe(1)
    expect(http.requests.length).toBe(1)
    expect(JSON.parse(http.requests[0].body!).text).toContain('Job 1 @ Acme')
    const after = await prisma.application.findUnique({ where: { id: app.id } })
    expect(after.followUpAt).toBeNull()
    expect(after.events.at(-1).type).toBe('follow_up_due')
    expect(await svc.sendFollowUpReminders()).toBe(0)
  })
})

describe('NotificationService · per-user digest hour (v5)', () => {
  it('serves each recipient at their own hour/timezone; env recipients at 08:00 IST', async () => {
    process.env.SMTP_HOST = 'x'; process.env.SMTP_USER = 'u'; process.env.EMAIL_TO = 'owner@x'
    const sent: string[] = []
    const u = await prisma.user.create({ data: { email: 'b@x' } })
    await prisma.alertChannel.create({ data: { userId: u.id, kind: 'email', address: 'b@x', classes: ['p1_global_remote'], instant: false, digest: true } })
    await prisma.user.create({ data: { email: 'o@x', role: 'admin' } })
    const s = new NotificationService(prisma, redis as any, { sendDigestEmail: async (_jobs, to) => { sent.push(to!) }, digestSchedule: async (id) => (id === u.id ? { hour: 18, timezone: 'America/New_York' } : null) })
    await mkJob(1)
    // 18:00 New York = 23:00 UTC; 08:00 Kolkata = 02:30 UTC
    expect(await s.sendDailyDigest({ dueAt: new Date('2026-06-01T22:00:00Z') })).toBe(1) // 18:00 EDT
    expect(sent).toEqual(['b@x'])
    expect(await s.sendDailyDigest({ dueAt: new Date('2026-06-02T02:30:00Z') })).toBe(1)
    expect(sent).toEqual(['b@x', 'owner@x'])
    expect(await s.sendDailyDigest({ dueAt: new Date('2026-06-02T10:00:00Z') })).toBe(0)
  })
})
