'use client'

import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiClient } from '../../../lib/api-client'
import type { Job } from '../../../lib/api-client'
import { formatRelativeDate } from '../../../lib/formatters'
import { AppShell } from '../layout/AppShell'
import { JobDetailPanel } from '../detail/JobDetailPanel'
import { Badge, Drawer, EmptyState, LinkButton, PageHeader, Stat } from '../ui'

const COLUMNS: Array<{ id: string; label: string; accent: string }> = [
  { id: 'applied', label: 'Applied', accent: 'bg-slate-400' },
  { id: 'interviewing', label: 'Interviewing', accent: 'bg-sky-500' },
  { id: 'offer', label: 'Offer', accent: 'bg-emerald-500' },
  { id: 'rejected', label: 'Rejected', accent: 'bg-rose-400' },
  { id: 'withdrawn', label: 'Withdrawn', accent: 'bg-slate-300' },
]

/** Applications: pipeline board (drag between stages) with the job detail in a drawer (HLD-ui-v8 §3). */
export function ApplicationsPage() {
  const { data, isLoading, mutate } = useSWR('applications', () => apiClient.getJobs({ tab: 'applied', limit: 100, sort: 'newest' }), { revalidateOnFocus: false })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const jobs = useMemo(() => data?.data ?? [], [data])
  const selected = jobs.find((j) => j.id === selectedId) ?? null

  const onJobUpdated = useCallback((updated: Job) => {
    mutate((prev) => (prev ? { ...prev, data: prev.data.map((j) => (j.id === updated.id ? { ...j, ...updated } : j)) } : prev), { revalidate: false })
  }, [mutate])

  async function move(jobId: string, status: string) {
    const j = jobs.find((x) => x.id === jobId)
    if (!j || j.application?.status === status) return
    onJobUpdated({ ...j, application: j.application ? { ...j.application, status } : j.application })
    onJobUpdated(await apiClient.recordApplication(jobId, { status }))
  }

  const counts = Object.fromEntries(COLUMNS.map((c) => [c.id, jobs.filter((j) => (j.application?.status ?? 'applied') === c.id).length]))
  const dueSoon = jobs.filter((j) => j.application?.followUpAt && new Date(j.application.followUpAt).getTime() < Date.now() + 3 * 86400_000).length

  return (
    <AppShell title="Applications" subtitle="Everything you applied to, by stage — drag cards to update">
      <PageHeader eyebrow="For you" title="Applications" description="Each card records exactly what you sent (resume version, headline, answers). Follow-up reminders come from the date on the card." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="In progress" value={counts.applied + counts.interviewing} hint="applied + interviewing" icon="briefcase" />
        <Stat label="Interviewing" value={counts.interviewing} tone={counts.interviewing ? 'accent' : 'neutral'} />
        <Stat label="Offers" value={counts.offer} tone={counts.offer ? 'success' : 'neutral'} />
        <Stat label="Follow-ups due ≤ 3 days" value={dueSoon} tone={dueSoon ? 'warning' : 'neutral'} icon="clock" />
      </div>
      {!isLoading && jobs.length === 0 ? (
        <div className="card"><EmptyState icon="briefcase" title="No applications yet" body="Mark a job as applied from its Apply kit (or from the browser extension) and it shows up here." action={<LinkButton href="/" variant="primary" size="sm" icon="inbox">Go to the inbox</LinkButton>} /></div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {COLUMNS.map((col) => {
            const items = jobs.filter((j) => (j.application?.status ?? 'applied') === col.id)
            return (
              <div key={col.id} onDragOver={(e) => { e.preventDefault(); setOver(col.id) }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); if (dragging) void move(dragging, col.id); setDragging(null); setOver(null) }} className={`flex min-h-[50vh] flex-col rounded-2xl border bg-slate-50/70 ${over === col.id ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-slate-700"><span className={`h-2 w-2 rounded-full ${col.accent}`} />{col.label}<span className="ml-auto rounded-full bg-white px-1.5 text-[10px] text-slate-500">{items.length}</span></div>
                <div className="flex-1 space-y-2 px-2 pb-2">
                  {items.map((j) => {
                    const due = j.application?.followUpAt ? new Date(j.application.followUpAt) : null
                    return (
                      <div key={j.id} data-smoke="pipeline-card" draggable onDragStart={() => setDragging(j.id)} onClick={() => setSelectedId(j.id)} className="cursor-grab rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-indigo-300">
                        <p className="truncate text-sm font-semibold text-slate-900">{j.title}</p>
                        <p className="truncate text-xs text-slate-500">{j.company}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                          {j.application?.appliedAt && <span>{formatRelativeDate(j.application.appliedAt)}</span>}
                          <Badge tone={j.application?.resumeVersionId ? 'accent' : 'neutral'}>{j.application?.resumeVersionId ? 'tailored' : 'original'}</Badge>
                          {j.application?.submittedVia === 'extension' && <Badge tone="violet">extension</Badge>}
                          {due && <Badge tone={due.getTime() < Date.now() ? 'danger' : 'warning'}>follow up {due.toLocaleDateString()}</Badge>}
                          {j.closedAt && <Badge tone="danger">posting closed</Badge>}
                        </div>
                      </div>
                    )
                  })}
                  {!items.length && <p className="px-1 pt-2 text-[11px] text-slate-400">Drop here</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <Drawer open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected ? `${selected.title} — ${selected.company}` : ''}>
        {selected && <JobDetailPanel key={selected.id} job={selected} onJobUpdated={onJobUpdated} />}
      </Drawer>
    </AppShell>
  )
}
