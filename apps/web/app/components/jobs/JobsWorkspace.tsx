'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { apiClient } from '../../../lib/api-client'
import type { Job, JobFilters } from '../../../lib/api-client'
import { AppShell } from '../layout/AppShell'
import { JobListToolbar, type Tab } from './JobListToolbar'
import { JobRow } from './JobRow'
import { GettingStarted } from './GettingStarted'
import { JobDetailPanel } from '../detail/JobDetailPanel'
import { Banner, EmptyState, LinkButton } from '../ui'

const LAST_VISIT_KEY = 'jobradar:lastVisit'

/**
 * Jobs workspace (direction A + C + D): dense list on the left, persistent detail on the right,
 * pipeline for Applied, getting-started for first run. Keyboard: j/k or ↑/↓ move, Enter focuses detail,
 * s = save, x = not interested, a = analyse.
 */
export function JobsWorkspace() {
  const [tab, setTab] = useState<Tab>('browse')
  const [filters, setFilters] = useState<JobFilters>({ tab: 'browse', page: 1, limit: 50 })
  const [selectedId, setSelectedId] = useState<string | null>(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('job') : null))
  const [pages, setPages] = useState<Job[]>([])
  /** < lg: the detail is a full-screen sheet opened by tapping a row (or a ?job= deep link); ≥ lg it is always the right pane. */
  const [mobileDetail, setMobileDetail] = useState<boolean>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('job'))
  const listRef = useRef<HTMLDivElement>(null)

  const { data: profileData } = useSWR('profile', () => apiClient.getProfile().catch(() => null))
  const { data: resumes } = useSWR('resumes', () => apiClient.getResumes().catch(() => ({ data: [] })))
  const hasProfile = Boolean(profileData?.profile && (profileData.profile.skills?.length ?? 0) > 0)
  const hasResume = (resumes?.data.length ?? 0) > 0

  // default sort: match once a profile exists
  const effectiveFilters = useMemo<JobFilters>(() => ({ ...filters, tab, sort: filters.sort ?? (hasProfile && tab === 'browse' ? 'match' : 'newest') }), [filters, tab, hasProfile])
  const swrKey = JSON.stringify(effectiveFilters)
  const { data, error, isLoading, mutate } = useSWR(swrKey, () => apiClient.getJobs(effectiveFilters), { revalidateOnFocus: false, keepPreviousData: true })

  // accumulate "load more" pages
  useEffect(() => {
    if (!data) return
    setPages((prev) => ((effectiveFilters.page ?? 1) > 1 ? [...prev.filter((j) => !data.data.some((d) => d.id === j.id)), ...data.data] : data.data))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  // "new since last visit"
  const [lastVisit, setLastVisit] = useState<string | null>(null)
  useEffect(() => {
    const prev = localStorage.getItem(LAST_VISIT_KEY)
    setLastVisit(prev)
    localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString())
  }, [])
  const { data: newSinceData } = useSWR(lastVisit ? `new-since:${lastVisit}` : null, () => apiClient.getJobs({ tab: 'browse', since: lastVisit!, limit: 1 }))
  const newSince = lastVisit && newSinceData ? { count: newSinceData.total, at: lastVisit } : null

  const jobs = pages
  const selected = jobs.find((j) => j.id === selectedId) ?? null
  const selectedIndex = jobs.findIndex((j) => j.id === selectedId)

  useEffect(() => { if (!selectedId && jobs.length) setSelectedId(jobs[0].id) }, [jobs, selectedId])

  const handleTab = (t: Tab) => { setTab(t); setFilters({ tab: t, page: 1, limit: 50 }); setSelectedId(null); setPages([]) }
  const handleFilters = (f: JobFilters) => { setFilters({ ...f, limit: 50 }); setSelectedId(null); setPages([]) }

  const handleJobUpdated = useCallback((updated: Job) => {
    setPages((prev) => prev.map((j) => (j.id === updated.id ? { ...j, ...updated } : j)))
    mutate((prev) => (prev ? { ...prev, data: prev.data.map((j) => (j.id === updated.id ? { ...j, ...updated } : j)) } : prev), { revalidate: false })
  }, [mutate])

  const move = useCallback((delta: number) => {
    if (!jobs.length) return
    const next = Math.max(0, Math.min(jobs.length - 1, (selectedIndex < 0 ? 0 : selectedIndex) + delta))
    setSelectedId(jobs[next].id)
    listRef.current?.querySelectorAll('[role=option]')[next]?.scrollIntoView({ block: 'nearest' })
  }, [jobs, selectedIndex])

  // keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
      else if (e.key === 's' && selected) { apiClient.saveJob(selected.id).then((u) => handleJobUpdated({ ...selected, ...u, progress: selected.progress, matchScore: selected.matchScore, matchWhy: selected.matchWhy })) }
      else if (e.key === 'x' && selected) { apiClient.rejectJob(selected.id).then((u) => { handleJobUpdated({ ...selected, ...u, progress: selected.progress, matchScore: selected.matchScore, matchWhy: selected.matchWhy }); move(1) }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, selected, handleJobUpdated])

  const firstRun = !hasResume && tab === 'browse' && !isLoading && jobs.length === 0

  return (
    <AppShell title="Inbox" subtitle="New postings evaluated against your preferences, newest first" fullBleed>
      {data?.evalsPending && <Banner tone="info">Your preferences are being applied to the job corpus — the inbox shows deployment defaults until the first evaluation finishes.<a href="/preferences" className="link ml-1">Review preferences</a></Banner>}
      <div className="grid h-[calc(100vh-6.5rem)] grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white lg:grid-cols-[minmax(400px,5fr)_7fr]">
        {/* left: list */}
        <div className="flex min-h-0 flex-col lg:border-r lg:border-slate-200">
          <JobListToolbar tab={tab} onTab={handleTab} filters={effectiveFilters} onFilters={handleFilters} hasProfile={hasProfile} newSince={newSince} total={data?.total ?? 0} unscored={data?.unscored} tiers={data?.tiers} />
          <div ref={listRef} role="listbox" className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
            {error && <p className="p-4 text-sm text-rose-600">Failed to load jobs. Is the database reachable?</p>}
            {firstRun ? (
              <GettingStarted hasResume={hasResume} hasProfile={hasProfile} hasJobs={(data?.total ?? 0) > 0} />
            ) : !isLoading && jobs.length === 0 ? (
              <EmptyState icon="inbox" title={tab === 'browse' ? 'Nothing matches these filters yet' : `Nothing in ${tab === 'rejected' ? 'not interested' : tab}`} body={tab === 'browse' ? 'New postings arrive every few minutes. Widen a tier or clear filters to see more.' : undefined} action={tab === 'browse' ? <LinkButton href="/preferences" size="sm" icon="sliders">Adjust preferences</LinkButton> : undefined} />
            ) : (
              jobs.map((j) => <JobRow key={j.id} job={j} selected={j.id === selectedId} onSelect={() => { setSelectedId(j.id); setMobileDetail(true) }} isNew={Boolean(lastVisit && j.firstSeenAt > lastVisit)} />)
            )}
            {data?.expandedTerms && data.expandedTerms.length > 0 && (
              <p className="px-4 py-2 text-[11px] text-slate-500">Also matching: {data.expandedTerms.slice(0, 8).join(', ')}{data.expandedTerms.length > 8 ? '…' : ''}{data.hybrid ? ' · plus matches by meaning' : ''}</p>
            )}
            {data && jobs.length < data.total && (
              <button onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))} className="w-full py-3 text-xs font-medium text-indigo-600 hover:bg-slate-50">Load more ({data.total - jobs.length} remaining){data.windowed ? ' · fit sort ranks the latest postings only' : ''}</button>
            )}
            {!hasResume && jobs.length > 0 && (
              <div className="m-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-900">Upload a resume under <a href="/resumes" className="link">Resumes</a> to get match scores, missing skills and tailored versions.</div>
            )}
          </div>
          <div className="border-t border-slate-200 px-4 py-1.5 text-[11px] text-slate-400"><span className="kbd">j</span>/<span className="kbd">k</span> move · <span className="kbd">s</span> save · <span className="kbd">x</span> not interested · fit = meaning · ATS = exact keywords</div>
        </div>

        {/* right: detail (full-screen sheet below lg) */}
        <div className={`min-h-0 bg-white ${mobileDetail ? 'fixed inset-0 z-40 flex flex-col lg:static lg:z-auto lg:block' : 'hidden lg:block'}`}>
          {mobileDetail && (
            <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 lg:hidden">
              <button onClick={() => setMobileDetail(false)} className="btn btn-ghost btn-sm" aria-label="Back to list">← Back to list</button>
              <span className="truncate text-sm font-medium text-slate-700">{selected?.title}</span>
            </div>
          )}
          {selected ? (
            <JobDetailPanel
              key={selected.id}
              job={selected}
              onJobUpdated={handleJobUpdated}
              onPrev={selectedIndex > 0 ? () => move(-1) : undefined}
              onNext={selectedIndex < jobs.length - 1 ? () => move(1) : undefined}
            />
          ) : (
            <EmptyState icon="target" title={isLoading ? 'Loading…' : 'Select a job'} body="Details, match analysis, tailoring and the apply kit appear here." />
          )}
        </div>
      </div>
    </AppShell>
  )
}
