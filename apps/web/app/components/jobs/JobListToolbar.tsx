'use client'

import { useState } from 'react'
import type { JobFilters } from '../../../lib/api-client'
import { Button, Icon, SegmentedControl } from '../ui'

export type Tab = 'browse' | 'saved' | 'rejected' | 'closed'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'browse', label: 'Inbox' },
  { id: 'saved', label: 'Saved' },
  { id: 'rejected', label: 'Not interested' },
  { id: 'closed', label: 'Closed' },
]
const LEGACY_CHIPS = [
  { id: 'eligible', label: 'All eligible' },
  { id: 'p1_global_remote', label: 'Global remote' },
  { id: 'p2_india_remote', label: 'India remote' },
  { id: 'p3_ncr_hybrid', label: 'NCR hybrid' },
  { id: 'none', label: 'Other' },
]

interface Props {
  tab: Tab
  onTab: (t: Tab) => void
  filters: JobFilters
  onFilters: (f: JobFilters) => void
  hasProfile: boolean
  newSince: { count: number; at: string } | null
  total: number
  unscored?: number
  /** v5: the user's tiers (chips replace the legacy classes when present). */
  tiers?: Array<{ id: string; label: string; enabled: boolean }>
}

/** Inbox toolbar: tabs · search · sort · tier chips · more filters. Applications live on their own page. */
export function JobListToolbar({ tab, onTab, filters, onFilters, hasProfile, newSince, total, unscored, tiers }: Props) {
  const [more, setMore] = useState(false)
  const [q, setQ] = useState(filters.q ?? '')
  const set = (patch: Partial<JobFilters>) => onFilters({ ...filters, ...patch, page: 1 })
  const activeClass = filters.class ?? 'eligible'
  const extraActive = [filters.remoteType, filters.region, filters.eligibility, filters.category, filters.salaryMin, filters.employmentType, filters.sourceType, filters.includeClosed].filter(Boolean).length
  const chips = tiers?.length ? [{ id: 'eligible', label: 'My tiers' }, ...tiers.filter((t) => t.enabled).map((t) => ({ id: t.id, label: t.label })), { id: 'none', label: 'Other' }] : LEGACY_CHIPS

  return (
    <div className="space-y-3 border-b border-slate-200 bg-white px-4 pb-3 pt-3">
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl value={tab} options={TABS} onChange={onTab} />
        <span className="text-xs text-slate-400" title={unscored ? `${unscored} job(s) not yet embedded — they appear under Fit sort after the next backfill` : ''}>{total.toLocaleString()} job{total === 1 ? '' : 's'}{unscored ? ` · ${unscored} unscored` : ''}</span>
      </div>
      <div className="flex items-center gap-2">
        <form onSubmit={(e) => { e.preventDefault(); set({ q: q || undefined }) }} className="relative flex-1">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, company, skill — press Enter" className="input pl-8" />
        </form>
        <select value={filters.sort ?? (hasProfile ? 'match' : 'newest')} onChange={(e) => set({ sort: e.target.value as JobFilters['sort'] })} className="input w-auto">
          <option value="match" disabled={!hasProfile}>Fit{hasProfile ? '' : ' (needs a resume)'}</option>
          <option value="newest">Newest</option>
          <option value="score">Score</option>
        </select>
        <Button variant={extraActive ? 'primary' : 'secondary'} size="md" icon="sliders" onClick={() => setMore((v) => !v)}>{extraActive ? `Filters · ${extraActive}` : 'Filters'}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <button key={c.id} onClick={() => set({ class: c.id === 'eligible' ? undefined : c.id })} className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${activeClass === c.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{c.label}</button>
        ))}
        {newSince && newSince.count > 0 && (
          <button onClick={() => set({ since: filters.since ? undefined : newSince.at })} className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ${filters.since ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>⚑ {newSince.count} new since last visit</button>
        )}
      </div>
      {more && (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-3">
          <select value={filters.employmentType ?? ''} onChange={(e) => set({ employmentType: (e.target.value || undefined) as JobFilters['employmentType'] })} className="input input-sm"><option value="">Full-time + contract</option><option value="full_time">Full-time only</option><option value="contract">Contract only</option></select>
          <select value={filters.remoteType ?? ''} onChange={(e) => set({ remoteType: e.target.value || undefined })} className="input input-sm"><option value="">Remote / hybrid / onsite</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">Onsite</option></select>
          <select value={filters.region ?? ''} onChange={(e) => set({ region: e.target.value || undefined })} className="input input-sm"><option value="">All regions</option>{['Global', 'Europe', 'UK', 'US', 'UAE', 'EMEA', 'APAC', 'Canada', 'Singapore', 'Australia', 'India'].map((r) => <option key={r} value={r}>{r}</option>)}</select>
          <select value={filters.eligibility ?? ''} onChange={(e) => set({ eligibility: e.target.value || undefined })} className="input input-sm"><option value="">Any eligibility</option><option value="india_allowed">India OK</option><option value="worldwide">Worldwide</option><option value="apac">APAC</option><option value="emea">EMEA</option></select>
          <input value={filters.category ?? ''} onChange={(e) => set({ category: e.target.value || undefined })} placeholder="Category (Backend…)" className="input input-sm" />
          <input value={filters.salaryMin ? String(Number(filters.salaryMin) / 100000) : ''} onChange={(e) => set({ salaryMin: e.target.value ? String(Number(e.target.value) * 100000) : undefined })} placeholder="Min ₹ lakh / yr" type="number" className="input input-sm" />
          <label className="col-span-full flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={filters.includeClosed === 'true'} onChange={(e) => set({ includeClosed: e.target.checked ? 'true' : undefined })} /> include closed postings</label>
        </div>
      )}
    </div>
  )
}
