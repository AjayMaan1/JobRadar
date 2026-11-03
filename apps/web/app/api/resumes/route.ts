import { NextRequest, NextResponse } from 'next/server'
import { MAX_UPLOAD_BYTES } from '@jobradar/resume'
import { requireUser, unauthorized, Unauthorized } from '../../../lib/auth'
import { limitUser } from '../../../lib/rate-limit'
import { services, USER_TASK_OPTS, queueErrorResponse } from '../../../lib/services'
import { log } from '@jobradar/log'

export async function GET() {
  try {
    const user = await requireUser()
    const data = await services().resumes.list(user.id)
    return NextResponse.json({ data })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    if (err instanceof Unauthorized) return unauthorized()
    log.error('GET /api/resumes error:', err)
    return NextResponse.json({ error: 'Failed to list resumes' }, { status: 500 })
  }
}

/** multipart/form-data: file (pdf|docx, ≤5 MB), label? → 202 { resume, taskId } */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const rl = await limitUser(user.id, 'upload'); if (rl) return rl
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 })
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 413 })
    const buffer = Buffer.from(await file.arrayBuffer())
    const label = typeof form.get('label') === 'string' ? String(form.get('label')) : undefined
    const { resumes, tasks, queues } = services()
    let resume
    try {
      resume = await resumes.createFromUpload({ userId: user.id, buffer, filename: file.name, label })
    } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
      return NextResponse.json({ error: (err as Error).message }, { status: 415 })
    }
    const task = await tasks.create('resume-parse', user.id)
    await queues.resumeParse.add('parse', { taskId: task.id, resumeId: resume.id, userId: user.id }, { ...USER_TASK_OPTS, jobId: `parse:${resume.id}` })
    return NextResponse.json({ resume: { id: resume.id, label: resume.label, parseStatus: resume.parseStatus, isMaster: resume.isMaster }, taskId: task.id }, { status: 202 })
  } catch (err) {
    { const qe = queueErrorResponse(err); if (qe) return qe }
    if (err instanceof Unauthorized) return unauthorized()
    log.error('POST /api/resumes error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
