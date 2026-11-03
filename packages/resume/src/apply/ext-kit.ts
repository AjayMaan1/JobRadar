import type { PrismaClient } from '@jobradar/db'
import type { ObjectStore } from '@jobradar/storage'
import { normalizeApplyUrl } from '@jobradar/extractor'
import { ResumeContentSchema, type ResumeContent } from '../schema/resume.js'
import { detectApplyAts, type ApplyAts } from './ats.js'
import type { ApplyDefaults } from './answers.js'

/**
 * Apply kit for the browser extension (docs/HLD-browser-extension.md): the profile basics every form asks for,
 * the file to attach, the drafted answers and cover note, and the matched job — resolved from the page URL.
 */
export interface ExtProfile {
  firstName: string
  lastName: string
  fullName: string
  email: string | null
  phone: string | null
  location: string | null
  city: string | null
  country: string | null
  linkedin: string | null
  github: string | null
  portfolio: string | null
  currentCompany: string | null
  currentTitle: string | null
  headline: string | null
  about: string | null
  applyDefaults: ApplyDefaults
}

export interface ExtKit {
  job: { id: string; title: string; company: string; applyUrl: string | null; ats: ApplyAts; matchedBy: 'url' | 'ats_id' | 'none' } | null
  ats: ApplyAts
  profile: ExtProfile
  resume: { versionId: string; kind: 'tailored' | 'master'; label: string; pdf: { url: string; filename: string } | null; docx: { url: string; filename: string } | null; original: { url: string; filename: string } | null } | null
  answers: Array<{ question: string; answer: string; flagged: boolean }>
  coverNote: string | null
  application: { id: string; status: string; appliedAt: Date | null } | null
}

/** ATS job ids from a page URL — greenhouse numeric id, lever/ashby uuid, workable shortcode. */
export function atsJobIdFromUrl(url: string): { ats: ApplyAts; id: string } | null {
  const ats = detectApplyAts(url)
  let u: URL
  try { u = new URL(url) } catch { return null }
  const path = u.pathname
  if (ats === 'greenhouse') { const m = path.match(/\/jobs\/(\d{5,})/) ?? u.searchParams.get('gh_jid')?.match(/(\d{5,})/); return m ? { ats, id: m[1] } : null }
  if (ats === 'lever' || ats === 'ashby') { const m = path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i); return m ? { ats, id: m[1].toLowerCase() } : null }
  if (ats === 'workable') { const m = path.match(/\/j\/([A-Z0-9]{6,12})/i); return m ? { ats, id: m[1].toUpperCase() } : null }
  if (ats === 'smartrecruiters') { const m = path.match(/(\d{12,})/); return m ? { ats, id: m[1] } : null }
  return null
}

export function profileFromContent(c: ResumeContent | null, profile: { headline: string | null; about: string | null; applyDefaults: ApplyDefaults } | null): ExtProfile {
  const b = c?.basics
  const name = (b?.name ?? '').trim()
  const parts = name.split(/\s+/).filter(Boolean)
  const link = (re: RegExp) => b?.profiles.find((p) => re.test(p.network) || re.test(p.url ?? ''))?.url ?? null
  const current = c?.work.find((w) => !w.endDate) ?? c?.work[0] ?? null
  const d = profile?.applyDefaults ?? {}
  return {
    firstName: parts[0] ?? '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : '',
    fullName: name,
    email: b?.email ?? null,
    phone: b?.phone ?? null,
    location: d.currentLocation ?? [b?.location?.city, b?.location?.region, b?.location?.countryCode].filter(Boolean).join(', ') ?? null,
    city: b?.location?.city ?? null,
    country: b?.location?.countryCode ?? null,
    linkedin: d.linkedin ?? link(/linkedin/i),
    github: link(/github/i),
    portfolio: d.portfolio ?? b?.url ?? link(/portfolio|website|personal/i),
    currentCompany: current?.name ?? null,
    currentTitle: current?.position ?? null,
    headline: b?.label ?? profile?.headline ?? null,
    about: b?.summary ?? profile?.about ?? null,
    applyDefaults: d,
  }
}

export class ExtKitService {
  constructor(private prisma: PrismaClient, private store: ObjectStore) {}

  /** Find the job a page belongs to: exact normalised URL, then ATS job id, else null (profile-only fill). */
  async resolveJob(pageUrl: string): Promise<{ job: { id: string; title: string; company: string; applyUrl: string | null } | null; matchedBy: 'url' | 'ats_id' | 'none' }> {
    const norm = normalizeApplyUrl(pageUrl)
    const bare = norm?.replace(/\/apply$/, '').replace(/#.*$/, '') ?? null
    if (norm) {
      const j = await this.prisma.job.findFirst({ where: { OR: [{ applyUrlNormalized: norm }, { applyUrlNormalized: bare ?? norm }, { applyUrl: { equals: pageUrl, mode: 'insensitive' } }, { sourceUrl: { equals: pageUrl, mode: 'insensitive' } }] }, orderBy: { firstSeenAt: 'desc' }, select: { id: true, title: true, company: true, applyUrl: true } })
      if (j) return { job: j, matchedBy: 'url' }
    }
    const ref = atsJobIdFromUrl(pageUrl)
    if (ref) {
      const j = await this.prisma.job.findFirst({ where: { OR: [{ applyUrl: { contains: ref.id, mode: 'insensitive' } }, { sourceUrl: { contains: ref.id, mode: 'insensitive' } }] }, orderBy: { firstSeenAt: 'desc' }, select: { id: true, title: true, company: true, applyUrl: true } })
      if (j) return { job: j, matchedBy: 'ats_id' }
    }
    return { job: null, matchedBy: 'none' }
  }

  async kit(userId: string, pageUrl: string): Promise<ExtKit> {
    const { job, matchedBy } = await this.resolveJob(pageUrl)
    const ats = detectApplyAts(pageUrl)
    const [profileRow, master] = await Promise.all([
      this.prisma.candidateProfile.findUnique({ where: { userId } }),
      this.prisma.resume.findFirst({ where: { userId, isMaster: true }, select: { id: true, label: true, currentVersionId: true, sourceFileKey: true, sourceFilename: true, sourceMime: true } }),
    ])
    const tailored = job ? await this.prisma.resumeVersion.findFirst({ where: { jobId: job.id, kind: 'tailored', renderStatus: 'rendered', resume: { userId } }, orderBy: { createdAt: 'desc' }, include: { resume: { select: { label: true } } } }) : null
    const masterVersion = master?.currentVersionId ? await this.prisma.resumeVersion.findUnique({ where: { id: master.currentVersionId } }) : null
    const version = tailored ?? masterVersion
    const content = version ? ResumeContentSchema.parse(version.content) : null
    const profile = profileFromContent(content, profileRow ? { headline: profileRow.headline, about: profileRow.about, applyDefaults: (profileRow.applyDefaults as ApplyDefaults | null) ?? {} } : null)
    const safe = (profile.fullName || 'resume').replace(/[^\w.-]+/g, '_').slice(0, 40)
    const signed = async (key: string | null | undefined, filename: string) => (key ? { url: await this.store.signedUrl(key, 900), filename } : null)
    const resume = version
      ? {
          versionId: version.id,
          kind: (tailored ? 'tailored' : 'master') as 'tailored' | 'master',
          label: tailored ? `Tailored for ${job?.title ?? 'this job'}` : (master?.label ?? 'Master resume'),
          pdf: await signed(version.pdfKey, `${safe}.pdf`),
          docx: await signed(version.docxKey, `${safe}.docx`),
          original: await signed(master?.sourceFileKey, master?.sourceFilename ?? `${safe}.pdf`),
        }
      : null
    let answers: ExtKit['answers'] = []
    let coverNote: string | null = null
    let application: ExtKit['application'] = null
    if (job) {
      const report = await this.prisma.atsReport.findFirst({ where: { jobId: job.id, resumeVersion: { resume: { userId } } }, orderBy: { createdAt: 'desc' }, select: { id: true } })
      if (report) {
        const rows = await this.prisma.suggestion.findMany({ where: { reportId: report.id, kind: { in: ['answer', 'cover_letter'] as never }, status: { not: 'rejected' } }, orderBy: { createdAt: 'asc' } })
        answers = rows.filter((r) => r.kind === 'answer' && r.question).map((r) => ({ question: r.question!, answer: r.userEdit ?? r.after ?? '', flagged: r.flagged }))
        const cover = rows.filter((r) => String(r.kind) === 'cover_letter').at(-1)
        coverNote = cover ? (cover.userEdit ?? cover.after) : null
      }
      const app = await this.prisma.application.findUnique({ where: { userId_jobId: { userId, jobId: job.id } }, select: { id: true, status: true, appliedAt: true, coverNote: true } })
      if (app) { application = { id: app.id, status: app.status, appliedAt: app.appliedAt }; coverNote = coverNote ?? app.coverNote }
    }
    return { job: job ? { ...job, ats: detectApplyAts(job.applyUrl ?? pageUrl), matchedBy } : null, ats, profile, resume, answers, coverNote, application }
  }
}
