import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient, Resume, ResumeVersion } from '@jobradar/db'
import type { LlmProvider } from '@jobradar/llm'
import type { ObjectStore } from '@jobradar/storage'
import { extractDocument, sniffFormat, MIME, type DocFormat } from '../parse/extract.js'
import { checkParseability, type ParseWarning } from '../parse/parseability.js'
import { structureResume, PARSER_VERSION } from '../parse/structure.js'
import { ResumeContentSchema, type ResumeContent } from '../schema/resume.js'
import { profileFromResume } from '../profile/seed.js'
import { ErasureService } from './erasure.service.js'
import { withTimeout } from '@jobradar/log'

/** A pathological PDF must not wedge the (single) LLM lane: hard cap on text extraction. */
const EXTRACT_TIMEOUT_MS = parseInt(process.env.RESUME_EXTRACT_TIMEOUT_MS ?? '60000', 10)

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export interface UploadInput {
  userId: string
  buffer: Buffer
  filename: string
  label?: string
}

export function contentHash(content: ResumeContent): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

export class ResumeService {
  constructor(private prisma: PrismaClient, private store: ObjectStore) {}

  /** Validate + store the original file and create the Resume row (status pending). Parsing runs in the worker. */
  async createFromUpload(input: UploadInput): Promise<Resume> {
    if (input.buffer.length === 0) throw new Error('Empty file')
    if (input.buffer.length > MAX_UPLOAD_BYTES) throw new Error(`File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`)
    const format = sniffFormat(input.buffer)
    if (!format || format === 'txt') throw new Error('Unsupported file type — upload a PDF or DOCX')
    const mime = MIME[format]
    const safeName = input.filename.replace(/[^\w. -]+/g, '_').slice(0, 120) || `resume.${format}`
    const data = { userId: input.userId, label: input.label?.trim() || safeName.replace(/\.(pdf|docx)$/i, ''), sourceMime: mime, sourceFilename: safeName, parseStatus: 'pending' }
    // Audit NEW-14: "first upload becomes master" decided inside a serializable transaction so two parallel
    // first uploads cannot both become master. Serialization failures (P2034) are retried.
    let resume: Resume | null = null
    for (let attempt = 0; attempt < 3 && !resume; attempt++) {
      try {
        resume = await this.prisma.$transaction(async (tx) => {
          const masters = await tx.resume.count({ where: { userId: input.userId, isMaster: true } })
          return tx.resume.create({ data: { ...data, isMaster: masters === 0 } })
        }, { isolationLevel: 'Serializable' as never })
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2034' || attempt === 2) throw err
      }
    }
    if (!resume) throw new Error('Could not create resume')
    const key = `users/${input.userId}/resumes/${resume.id}/original.${format}`
    await this.store.put(key, input.buffer, { contentType: mime, filename: safeName })
    return this.prisma.resume.update({ where: { id: resume.id }, data: { sourceFileKey: key } })
  }

  /** Worker: extract → parseability → structure (LLM) → master version → profile seed. */
  async parse(resumeId: string, llm: LlmProvider | null, onProgress?: (msg: string) => Promise<void> | void): Promise<{ resume: Resume; version: ResumeVersion; warnings: ParseWarning[] }> {
    const resume = await this.prisma.resume.findUnique({ where: { id: resumeId } })
    if (!resume || !resume.sourceFileKey) throw new Error('Resume or file not found')
    await this.prisma.resume.update({ where: { id: resumeId }, data: { parseStatus: 'parsing', parseError: null } })
    try {
      await onProgress?.('Extracting text')
      const buf = await this.store.get(resume.sourceFileKey)
      const format = (resume.sourceMime === MIME.docx ? 'docx' : resume.sourceMime === MIME.pdf ? 'pdf' : undefined) as DocFormat | undefined
      const doc = await withTimeout(extractDocument(buf, format), EXTRACT_TIMEOUT_MS, 'resume text extraction')
      const warnings = checkParseability(doc)
      const fatal = warnings.some((w) => w.code === 'no_text')

      await onProgress?.(llm ? 'Structuring with AI' : 'Structuring (no AI configured)')
      const structured = fatal ? { content: ResumeContentSchema.parse({}), llmUsed: false } : await structureResume(doc.text, llm, { userId: resume.userId })
      const content = structured.content

      const version = await this.prisma.resumeVersion.create({
        data: {
          resumeId,
          kind: 'master',
          content: content as unknown as Prisma.InputJsonValue,
          contentHash: contentHash(content),
          changeLog: { parser: PARSER_VERSION, llmUsed: structured.llmUsed, format: doc.format, pages: doc.pages } as Prisma.InputJsonValue,
        },
      })
      const status = fatal ? 'failed' : structured.llmUsed ? (warnings.some((w) => w.severity === 'error') ? 'needs_review' : 'parsed') : 'needs_review'
      const updated = await this.prisma.resume.update({
        where: { id: resumeId },
        data: {
          parseStatus: status,
          parseError: fatal ? 'No machine-readable text found' : null,
          parseWarnings: warnings as unknown as Prisma.InputJsonValue,
          rawText: doc.text.slice(0, 200_000),
          currentVersionId: version.id,
        },
      })
      if (!fatal && updated.isMaster) await this.seedProfile(resume.userId, content)
      return { resume: updated, version, warnings }
    } catch (err) {
      await this.prisma.resume.update({ where: { id: resumeId }, data: { parseStatus: 'failed', parseError: (err as Error).message.slice(0, 500) } })
      throw err
    }
  }

  /** Profile seeding: fill empty fields, merge skills (never remove user-added ones). */
  async seedProfile(userId: string, content: ResumeContent): Promise<void> {
    const seed = profileFromResume(content)
    const existing = await this.prisma.candidateProfile.findUnique({ where: { userId } })
    const prevSkills = ((existing?.skills as Array<{ name: string; canonical: string; confirmed?: boolean; source?: string }> | null) ?? [])
    const byCanonical = new Map(prevSkills.map((s) => [s.canonical.toLowerCase(), s]))
    for (const s of seed.skills) if (!byCanonical.has(s.canonical.toLowerCase())) byCanonical.set(s.canonical.toLowerCase(), s)
    const skills = [...byCanonical.values()] as unknown as Prisma.InputJsonValue
    await this.prisma.candidateProfile.upsert({
      where: { userId },
      create: { userId, headline: seed.headline, about: seed.about, targetTitles: seed.targetTitles, skills, yearsExperience: seed.yearsExperience },
      update: {
        skills,
        ...(existing?.headline ? {} : { headline: seed.headline }),
        ...(existing?.about ? {} : { about: seed.about }),
        ...(existing?.targetTitles.length ? {} : { targetTitles: seed.targetTitles }),
        ...(existing?.yearsExperience ? {} : { yearsExperience: seed.yearsExperience }),
      },
    })
  }

  /** User correction of the parse: new immutable version (kind=correction) becomes current. */
  async correct(resumeId: string, userId: string, input: unknown): Promise<ResumeVersion> {
    const resume = await this.prisma.resume.findFirst({ where: { id: resumeId, userId } })
    if (!resume) throw new Error('Resume not found')
    const content = ResumeContentSchema.parse(input)
    const version = await this.prisma.resumeVersion.create({
      data: { resumeId, parentId: resume.currentVersionId, kind: 'correction', content: content as unknown as Prisma.InputJsonValue, contentHash: contentHash(content), changeLog: { by: 'user' } },
    })
    await this.prisma.resume.update({ where: { id: resumeId }, data: { currentVersionId: version.id, parseStatus: resume.parseStatus === 'needs_review' ? 'parsed' : resume.parseStatus } })
    if (resume.isMaster) await this.seedProfile(userId, content)
    return version
  }

  async list(userId: string) {
    return this.prisma.resume.findMany({ where: { userId }, orderBy: [{ isMaster: 'desc' }, { createdAt: 'desc' }], select: { id: true, label: true, isMaster: true, parseStatus: true, parseError: true, parseWarnings: true, sourceFilename: true, currentVersionId: true, createdAt: true, updatedAt: true } })
  }

  async get(resumeId: string, userId: string) {
    const resume = await this.prisma.resume.findFirst({ where: { id: resumeId, userId } })
    if (!resume) return null
    const current = resume.currentVersionId ? await this.prisma.resumeVersion.findUnique({ where: { id: resume.currentVersionId } }) : null
    const versions = await this.prisma.resumeVersion.findMany({ where: { resumeId }, orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, parentId: true, jobId: true, createdAt: true, renderStatus: true, contentHash: true } })
    return { resume, current, versions }
  }

  async setMaster(resumeId: string, userId: string): Promise<void> {
    const resume = await this.prisma.resume.findFirst({ where: { id: resumeId, userId } })
    if (!resume) throw new Error('Resume not found')
    await this.prisma.$transaction([
      this.prisma.resume.updateMany({ where: { userId }, data: { isMaster: false } }),
      this.prisma.resume.update({ where: { id: resumeId }, data: { isMaster: true } }),
    ])
    const current = resume.currentVersionId ? await this.prisma.resumeVersion.findUnique({ where: { id: resume.currentVersionId } }) : null
    if (current) await this.seedProfile(userId, ResumeContentSchema.parse(current.content))
  }

  /** Vectors → files → rows (audit NEW-01); see ErasureService for the invariant. */
  async delete(resumeId: string, userId: string): Promise<boolean> {
    const r = await new ErasureService(this.prisma, this.store).eraseResume(resumeId, userId)
    return r !== null
  }

  /** Signed download URL for the original upload. */
  async originalUrl(resumeId: string, userId: string): Promise<string | null> {
    const resume = await this.prisma.resume.findFirst({ where: { id: resumeId, userId } })
    if (!resume?.sourceFileKey) return null
    return this.store.signedUrl(resume.sourceFileKey, 600)
  }
}
