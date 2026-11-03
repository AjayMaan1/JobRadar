import { describe, it, expect, beforeEach } from 'vitest'
import { createFakePrisma } from '../../../../tools/testkit/fake-prisma.js'
import { ErasureService } from './erasure.service.js'

/**
 * Audit NEW-01 regression: `embeddings` has no FK, so account/resume deletion must remove vectors (and the
 * chunk text stored next to them) explicitly. The v3 e2e ran with EMBEDDING_PROVIDER=none and could not see it.
 */
const fakeStore = () => {
  const deleted: string[] = []
  return {
    deleted,
    delete: async (k: string) => { deleted.push(k) },
    deletePrefix: async (p: string) => { deleted.push(`${p}/*`); return 2 },
  }
}

async function seed(prisma: ReturnType<typeof createFakePrisma>) {
  const user = await prisma.user.create({ data: { email: 'a@x.test' } })
  await prisma.candidateProfile.create({ data: { userId: user.id, headline: 'Eng' } })
  const resume = await prisma.resume.create({ data: { userId: user.id, label: 'r', isMaster: true } })
  const v1 = await prisma.resumeVersion.create({ data: { resumeId: resume.id, content: {}, contentHash: 'h1' } })
  const v2 = await prisma.resumeVersion.create({ data: { resumeId: resume.id, parentId: v1.id, kind: 'tailored', content: {}, contentHash: 'h2', pdfKey: `users/${user.id}/v2.pdf`, docxKey: `users/${user.id}/v2.docx` } })
  const job = await prisma.job.create({ data: { title: 'T', company: 'C', sourceName: 's', skills: '[]', canonicalHash: 'c1' } })
  const emb = (ownerType: string, ownerId: string, chunkKey: string) => prisma.embedding.create({ data: { ownerType, ownerId, chunkKey, text: 'Led Kafka migration at Acme', textHash: 'x', model: 'm', dims: 2, vector: Buffer.from([0, 0]) } })
  await emb('resume_version', v1.id, 'summary')
  await emb('resume_version', v2.id, 'work/0/highlights/0')
  await emb('profile', user.id, 'headline')
  await emb('job', job.id, 'head')
  await emb('requirement', job.id, 'req:Kafka')
  await prisma.jobFit.create({ data: { userId: user.id, jobId: job.id, fitScore: 50, model: 'm' } })
  return { user, resume, v1, v2, job }
}

describe('ErasureService', () => {
  let prisma: ReturnType<typeof createFakePrisma>
  beforeEach(() => { prisma = createFakePrisma() })

  it('eraseUser removes profile + version vectors, the file prefix and the user row; job vectors untouched', async () => {
    const { user, job } = await seed(prisma)
    const store = fakeStore()
    const r = await new ErasureService(prisma as never, store).eraseUser(user.id)
    expect(r.embeddings).toBe(3)
    expect(store.deleted).toEqual([`users/${user.id}/*`])
    expect(await prisma.embedding.count({ where: { ownerType: { in: ['resume_version', 'profile'] } } })).toBe(0)
    expect(await prisma.embedding.count({ where: { ownerId: job.id } })).toBe(2)
    expect(await prisma.user.count()).toBe(0)
  })

  it('eraseResume only touches that resume (scoped by user) and returns null for another user', async () => {
    const { user, resume } = await seed(prisma)
    const other = await prisma.user.create({ data: { email: 'b@x.test' } })
    const store = fakeStore()
    const svc = new ErasureService(prisma as never, store)
    expect(await svc.eraseResume(resume.id, other.id)).toBeNull()
    const r = await svc.eraseResume(resume.id, user.id)
    expect(r?.embeddings).toBe(2)
    expect(store.deleted).toEqual([`users/${user.id}/resumes/${resume.id}/*`])
    expect(await prisma.embedding.count({ where: { ownerType: 'profile' } })).toBe(1) // profile vector stays with the account
    expect(await prisma.resume.count()).toBe(0)
  })

  it('eraseResumeVersions deletes rendered files + vectors for retention', async () => {
    const { v2 } = await seed(prisma)
    const store = fakeStore()
    const r = await new ErasureService(prisma as never, store).eraseResumeVersions([v2.id])
    expect(r).toEqual({ embeddings: 1, files: 2 })
    expect(store.deleted).toHaveLength(2)
  })

  it('pruneClosedJobVectors removes vectors of long-closed jobs and of jobs whose row is gone', async () => {
    const { job } = await seed(prisma)
    const svc = new ErasureService(prisma as never)
    expect(await svc.pruneClosedJobVectors(30)).toBe(0) // open job: keep
    await prisma.job.update({ where: { id: job.id }, data: { closedAt: new Date(Date.now() - 40 * 86400_000) } })
    expect(await svc.pruneClosedJobVectors(30)).toBe(2)
    await prisma.embedding.create({ data: { ownerType: 'job', ownerId: 'gone-job', chunkKey: 'head', text: 't', textHash: 'x', model: 'm', dims: 2, vector: Buffer.from([0, 0]) } })
    expect(await svc.pruneClosedJobVectors(30)).toBe(1)
  })

  it('sweepOrphanVectors catches vectors whose owner vanished through any path', async () => {
    const { v1 } = await seed(prisma)
    await prisma.resumeVersion.delete({ where: { id: v1.id } }) // bypassing the hooks
    expect(await new ErasureService(prisma as never).sweepOrphanVectors()).toBe(1)
    expect(await new ErasureService(prisma as never).sweepOrphanVectors()).toBe(0)
  })
})

describe('ErasureService.sweepOrphanFiles (audit NEW-22)', () => {
  it('removes unreferenced files, keeps referenced ones and in-flight uploads', async () => {
    const prisma = createFakePrisma()
    const user = await prisma.user.create({ data: { email: 'a@x.test' } })
    const resume = await prisma.resume.create({ data: { userId: user.id, label: 'r', sourceFileKey: `users/${user.id}/resumes/r1/original.pdf` } })
    await prisma.resumeVersion.create({ data: { resumeId: resume.id, content: {}, contentHash: 'h', pdfKey: `users/${user.id}/versions/v1.pdf` } })
    const now = Date.now()
    const files: Record<string, number> = {
      [`users/${user.id}/resumes/r1/original.pdf`]: now - 3600_000,   // referenced → keep
      [`users/${user.id}/versions/v1.pdf`]: now - 3600_000,            // referenced → keep
      [`users/${user.id}/versions/v-old.pdf`]: now - 3600_000,         // orphan render → delete
      [`users/${user.id}/resumes/r9/original.pdf`]: now - 10_000,      // in-flight upload (young) → keep
      [`users/${user.id}/resumes/r8/original.pdf`]: now - 7200_000,    // old orphan upload → delete
      ['users/ghost/resumes/r1/original.pdf']: now - 10_000,           // user gone → delete regardless of age
    }
    const deleted: string[] = []
    const store = {
      list: async () => Object.keys(files),
      delete: async (k: string) => { deleted.push(k) },
      deletePrefix: async () => 0,
      head: async (k: string) => (k in files ? { size: 1 } : null),
      mtime: async (k: string) => files[k] ?? null,
    }
    const r = await new ErasureService(prisma as never, store as never).sweepOrphanFiles({ graceMinutes: 60 })
    expect(r.scanned).toBe(6)
    expect(deleted.sort()).toEqual([`users/${user.id}/resumes/r8/original.pdf`, `users/${user.id}/versions/v-old.pdf`, 'users/ghost/resumes/r1/original.pdf'].sort())
  })
})
