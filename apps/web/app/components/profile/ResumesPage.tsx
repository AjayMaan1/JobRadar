'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '../layout/AppShell'
import { apiClient } from '../../../lib/api-client'
import type { ResumeDetail, ResumeRow } from '../../../lib/api-client'
import { ResumeUpload } from './ResumeUpload'
import { ResumeList } from './ResumeList'
import { ResumeReview } from './ResumeReview'
import { Card, CardHeader, EmptyState, LinkButton, PageHeader } from '../ui'

/** Resumes: upload, versions, parse review — the master copy that every match score and tailored version starts from. */
export function ResumesPage() {
  const [resumes, setResumes] = useState<ResumeRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ResumeDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try { const r = await apiClient.getResumes(); setResumes(r.data); setError(null); if (!selectedId && r.data[0]) setSelectedId(r.data[0].id) } catch (err) { setError((err as Error).message) }
  }, [selectedId])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (!selectedId) { setDetail(null); return } apiClient.getResume(selectedId).then(setDetail).catch(() => setDetail(null)) }, [selectedId])
  useEffect(() => {
    if (!resumes.some((r) => r.parseStatus === 'pending' || r.parseStatus === 'parsing')) return
    const t = setInterval(() => void refresh(), 2500)
    return () => clearInterval(t)
  }, [resumes, refresh])

  const master = resumes.find((r) => r.isMaster)
  return (
    <AppShell title="Resumes" subtitle="Master copy, corrections and tailored versions">
      <PageHeader eyebrow="For you" title="Resumes" description="Upload once; we parse it into a structured master copy you verify. Tailored versions are created per job and never change the master." actions={master && master.parseStatus !== 'failed' ? <LinkButton href={`/resumes/${master.id}/edit`} variant="primary" icon="edit">Open editor</LinkButton> : undefined} />
      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
        <div className="space-y-4">
          <Card><CardHeader title="Upload" description="PDF or DOCX, up to 5 MB. Contact details are masked before any AI processing." icon="upload" /><ResumeUpload onUploaded={async () => { await refresh() }} /></Card>
          <Card><CardHeader title={`Your resumes${resumes.length ? ` (${resumes.length})` : ''}`} description="The master drives match scores and the profile seed." icon="file" /><ResumeList resumes={resumes} selectedId={selectedId} onSelect={setSelectedId} onChanged={refresh} /></Card>
        </div>
        <div>
          {detail ? (
            <ResumeReview detail={detail} onSaved={async () => { await refresh(); setDetail(await apiClient.getResume(detail.resume.id)) }} />
          ) : (
            <Card padded={false}><EmptyState icon="file" title={resumes.length ? 'Select a resume' : 'No resume yet'} body={resumes.length ? 'Review how it was parsed, fix fields, or open the visual editor.' : 'Upload your first resume to unlock match scores, suggestions and tailored versions.'} /></Card>
          )}
        </div>
      </div>
    </AppShell>
  )
}
