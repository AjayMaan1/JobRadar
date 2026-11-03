import { NextResponse } from 'next/server'
import { prisma } from '@jobradar/db'
import { log } from '@jobradar/log'
import { authErrorResponse, requireUser } from '../../../../lib/auth'
import { limitUser } from '../../../../lib/rate-limit'
import { services } from '../../../../lib/services'

/**
 * Data export (GH-7, pairs with DELETE /api/me): everything the account owns as one JSON document, with
 * short-lived signed links for the files. Password hashes, session tokens and other users' data are never included.
 */
export async function GET() {
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'export'); if (rl) return rl
    const { store } = services()
    const [profile, resumes, versions, reports, applications, states, fits, channels, sessions] = await Promise.all([
      prisma.candidateProfile.findUnique({ where: { userId: user.id } }),
      prisma.resume.findMany({ where: { userId: user.id } }),
      prisma.resumeVersion.findMany({ where: { resume: { userId: user.id } }, include: { reports: { include: { suggestions: true } } } }),
      prisma.atsReport.findMany({ where: { resumeVersion: { resume: { userId: user.id } } }, include: { job: { select: { id: true, title: true, company: true, applyUrl: true } } } }),
      prisma.application.findMany({ where: { userId: user.id }, include: { job: { select: { id: true, title: true, company: true, applyUrl: true, sourceUrl: true } } } }),
      prisma.jobUserState.findMany({ where: { userId: user.id }, include: { job: { select: { id: true, title: true, company: true, applyUrl: true } } } }),
      prisma.jobFit.findMany({ where: { userId: user.id }, select: { jobId: true, fitScore: true, keywordScore: true, updatedAt: true } }),
      prisma.alertChannel.findMany({ where: { userId: user.id } }),
      prisma.session.findMany({ where: { userId: user.id }, select: { id: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true } }),
    ])
    const [preferences, preferenceHistory, presets, evalCount] = await Promise.all([
      prisma.userPreferences.findUnique({ where: { userId: user.id } }),
      prisma.preferenceHistory.findMany({ where: { userId: user.id }, orderBy: { version: 'asc' } }),
      prisma.preferencePreset.findMany({ where: { ownerUserId: user.id } }),
      prisma.jobUserEval.count({ where: { userId: user.id } }),
    ])
    const files: Record<string, string> = {}
    for (const r of resumes) if (r.sourceFileKey) files[`resume:${r.id}:original`] = await store.signedUrl(r.sourceFileKey, 900)
    for (const v of versions) {
      if (v.pdfKey) files[`version:${v.id}:pdf`] = await store.signedUrl(v.pdfKey, 900)
      if (v.docxKey) files[`version:${v.id}:docx`] = await store.signedUrl(v.docxKey, 900)
    }
    log.info('data export generated', { userId: user.id, resumes: resumes.length, versions: versions.length, applications: applications.length })
    const body = { exportedAt: new Date().toISOString(), user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt }, profile, preferences, preferenceHistory, presets, evaluations: { count: evalCount, note: 'derived per-job evaluations are not exported; they are recomputed from preferences' }, resumes, versions, reports, applications, jobStates: states, fits, alertChannels: channels, sessions, files }
    return new NextResponse(JSON.stringify(body, null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="jobradar-export-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'private, no-store' } })
  } catch (err) {
    return authErrorResponse(err) ?? (log.error('GET /api/me/export failed', err as Error), NextResponse.json({ error: 'Export failed' }, { status: 500 }))
  }
}
