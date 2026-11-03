import { describe, expect, it, beforeEach } from 'vitest'
import { createFakePrisma } from '../../../../tools/testkit/fake-prisma.js'
import { PreferencesService } from './preferences.service.js'
import { EvalService } from './eval.service.js'
import { CrawlScopeService } from './crawl-scope.service.js'
import { SYSTEM_PRESETS } from '../presets.js'
import { extractJobFacts } from '@jobradar/extractor'

let prisma: ReturnType<typeof createFakePrisma>
beforeEach(() => { prisma = createFakePrisma(); process.env.PAY_FLOOR_INR = '3000000'; delete process.env.PREFS_ENGINE })

const mkJob = async (o: Record<string, unknown> = {}, facts?: Parameters<typeof extractJobFacts>[0]) => {
  const j = await prisma.job.create({ data: { title: 'Senior Backend Engineer', company: 'Acme', sourceName: 's', skills: '["Go","Kafka"]', canonicalHash: `h${Math.random()}`, status: 'new', employmentType: 'full_time', remoteType: 'remote', ...o } })
  if (facts) await prisma.jobFacts.create({ data: { jobId: j.id, facts: extractJobFacts(facts), version: 'facts-v1' } })
  return j
}
const remoteWorldwide = { title: 'Senior Backend Engineer', location: 'Remote, Worldwide', description: '', remoteType: 'remote' as const, employmentType: 'full_time' as const, skills: ['Go', 'Kafka'], company: { hqCountry: 'US', tags: [] } }
const remoteUs = { ...remoteWorldwide, location: 'Remote - US' }
const hybridBlr = { ...remoteWorldwide, location: 'Bengaluru, India', remoteType: 'hybrid' as const, company: { hqCountry: 'US', tags: ['mnc'] } }

describe('PreferencesService', () => {
  it('seeds the owner from the legacy env, keeps history, reverts, and applies presets without moving home', async () => {
    const owner = await prisma.user.create({ data: { email: 'o@x', role: 'admin', lastLoginAt: new Date() } })
    await prisma.candidateProfile.create({ data: { userId: owner.id, skills: [{ name: 'Rust', canonical: 'Rust' }], targetTitles: ['Platform Engineer'] } })
    const svc = new PreferencesService(prisma as never)
    const first = await svc.ensure(owner.id)
    expect(first.version).toBe(1)
    expect(first.source).toBe('seed')
    expect(first.doc.home.country).toBe('IN')
    expect(first.doc.pay.floor).toBe(3_000_000)
    expect(first.doc.role.skills).toContain('Rust')           // seeded from the profile
    expect(first.doc.role.targetTitles).toEqual(['Platform Engineer'])
    expect((await svc.ensure(owner.id)).version).toBe(1)      // idempotent

    const edited = structuredClone(first.doc)
    edited.home.metros = ['bengaluru']
    edited.pay.floor = 4_000_000
    const v2 = await svc.save(owner.id, edited, { note: 'moved' })
    expect(v2.version).toBe(2)
    expect((await svc.history(owner.id)).map((h) => h.version)).toEqual([2, 1])

    const v3 = await svc.revert(owner.id, 1)
    expect(v3.version).toBe(3)
    expect(v3.doc.pay.floor).toBe(3_000_000)

    await svc.ensureSystemPresets()
    const presets = await svc.presets(owner.id)
    expect(presets.filter((p) => p.system).map((p) => p.name)).toEqual(expect.arrayContaining(['legacy-india-remote', 'us-remote', 'eu-remote', 'hybrid-metro']))
    const eu = presets.find((p) => p.name === 'eu-remote')!
    const v4 = await svc.applyPreset(owner.id, eu.id)
    expect(v4.doc.home.country).toBe('IN')                    // home kept (replaceHome=false)
    expect(v4.doc.tiers.map((t) => t.label)).toContain('Remote (EU eligible)')
    const v5 = await svc.applyPreset(owner.id, eu.id, { replaceHome: true })
    expect(v5.doc.home.country).toBe('DE')

    await svc.savePreset(owner.id, 'mine', v5.doc, 'my preset')
    expect((await svc.presets(owner.id)).some((p) => !p.system && p.name === 'mine')).toBe(true)
    expect(await svc.deletePreset(owner.id, eu.id)).toBe(false) // system presets are protected
    await expect(svc.save(owner.id, { ...edited, tiers: [] })).rejects.toThrow()
  })
})

describe('EvalService', () => {
  it('evaluates a job for every active user with their own tiers, and re-evaluation is idempotent per version', async () => {
    const svc = new PreferencesService(prisma as never)
    const evals = new EvalService(prisma as never, { userCacheMs: 0 })
    const indian = await prisma.user.create({ data: { email: 'in@x', role: 'admin', lastLoginAt: new Date() } })
    const american = await prisma.user.create({ data: { email: 'us@x', lastLoginAt: new Date() } })
    const dormant = await prisma.user.create({ data: { email: 'old@x', lastLoginAt: new Date(Date.now() - 200 * 86400_000) } })
    await svc.ensure(indian.id)
    await svc.save(american.id, SYSTEM_PRESETS.find((p) => p.name === 'us-remote')!.doc)
    await svc.save(dormant.id, SYSTEM_PRESETS[0].doc)

    const j1 = await mkJob({}, remoteWorldwide)
    const j2 = await mkJob({}, remoteUs)
    const j3 = await mkJob({ remoteType: 'hybrid' }, hybridBlr)
    const r1 = await evals.evaluateJob(j1)
    expect([...r1.keys()].sort()).toEqual([indian.id, american.id].sort()) // dormant user not fanned out
    expect(r1.get(indian.id)!.tier).toBe('tier1')
    expect(r1.get(american.id)!.tier).toBe('tier1')
    const r2 = await evals.evaluateJob(j2)
    expect(r2.get(indian.id)!.tier).toBe('none')
    expect(r2.get(american.id)!.tier).toBe('tier2')
    const r3 = await evals.evaluateJob(j3)
    expect(r3.get(indian.id)!.tier).toBe('none') // NCR-only hybrid in the legacy preset
    expect(await prisma.jobUserEval.count()).toBe(6)

    // Indian user moves to Bengaluru + accepts hybrid at any company → re-evaluation flips j3
    const cur = (await svc.get(indian.id))!
    const doc = structuredClone(cur.doc)
    doc.home.metros = ['bengaluru']
    doc.tiers.find((t) => t.id === 'tier3')!.when.companyTag = undefined
    const saved = await svc.save(indian.id, doc)
    const run = await evals.reevaluateUser(indian.id, saved.version)
    expect(run).toEqual({ evaluated: 3, skipped: false })
    expect((await prisma.jobUserEval.findUnique({ where: { userId_jobId: { userId: indian.id, jobId: j3.id } } })).tier).toBe('tier3')
    expect(await evals.reevaluateUser(indian.id, saved.version)).toEqual({ evaluated: 0, skipped: false }) // idempotent
    expect((await evals.reevaluateUser(indian.id, saved.version - 1)).skipped).toBe(true)                // superseded
    // american user untouched
    expect((await prisma.jobUserEval.findUnique({ where: { userId_jobId: { userId: american.id, jobId: j3.id } } })).tier).toBe('none')
  })

  it('derives facts for pre-v5 jobs without a facts row and previews without writing', async () => {
    const svc = new PreferencesService(prisma as never)
    const evals = new EvalService(prisma as never, { userCacheMs: 0 })
    const u = await prisma.user.create({ data: { email: 'in@x', role: 'admin', lastLoginAt: new Date() } })
    await svc.ensure(u.id)
    const legacy = await mkJob({ country: 'IN', region: 'India', city: 'Remote', remoteType: 'remote', eligibility: 'worldwide', eligibilityEvidence: 'work from anywhere' })
    const r = await evals.evaluateJob(legacy)
    expect(r.get(u.id)!.tier).toBe('tier2') // "Remote" + India in the row → remote in my country
    expect(await prisma.jobFacts.count({ where: { jobId: legacy.id } })).toBe(1)
    const before = await prisma.jobUserEval.count()
    const preview = await evals.preview(SYSTEM_PRESETS.find((p) => p.name === 'us-remote')!.doc, 100)
    expect(preview.sample).toBe(1)
    expect(preview.counts).toEqual({ tier1: 1 }) // "work from anywhere" → eligible from the US too
    expect(await prisma.jobUserEval.count()).toBe(before)
  })
})

describe('CrawlScopeService (union of users)', () => {
  it('computes excluded HQs as the intersection, the lowest pay floor in USD, metros as the union; single-user auto-applies Workday scopes', async () => {
    const svc = new PreferencesService(prisma as never)
    const evals = new EvalService(prisma as never, { userCacheMs: 0 })
    const scope = new CrawlScopeService(prisma as never, evals)
    const a = await prisma.user.create({ data: { email: 'a@x', role: 'admin', lastLoginAt: new Date() } })
    await svc.ensure(a.id) // IN, delhi-ncr, floor 30L INR, excludes IN HQ
    const c = await prisma.company.create({ data: { name: 'Wd', normalizedName: 'wd', discoveredVia: 'manual' } })
    const board = await prisma.companyBoard.create({ data: { companyId: c.id, atsType: 'workday', slug: 'wd/x', host: 'wd.myworkdayjobs.com', apiUrl: 'https://wd', costClass: 'expensive', queryScope: { searchText: 'Bengaluru' } } })
    let s = await scope.scope(true)
    expect(s).toMatchObject({ users: 1, excludedHqCountries: ['IN'], metros: ['delhi-ncr'], countries: ['IN'] })
    expect(s.floorUsd).toBe(Math.round(3_000_000 / 84.5))
    const sugg = await scope.suggestions()
    expect(sugg.map((x) => x.metro)).toEqual(['delhi-ncr'])
    expect(await scope.autoApplyIfSingleUser()).toBe(1)
    expect(((await prisma.companyBoard.findUnique({ where: { id: board.id } })).queryScope as { searchText: string }).searchText).toBe('Bengaluru Delhi NCR')
    // second user with no floor and no HQ exclusion → floor disappears, exclusions intersect to []
    const b = await prisma.user.create({ data: { email: 'b@x', lastLoginAt: new Date() } })
    await svc.save(b.id, SYSTEM_PRESETS.find((p) => p.name === 'us-remote')!.doc)
    s = await scope.scope(true)
    expect(s).toMatchObject({ users: 2, excludedHqCountries: [], floorUsd: null })
    expect(s.countries.sort()).toEqual(['IN', 'US'])
    expect(await scope.autoApplyIfSingleUser()).toBe(0)
  })
})
