'use client'

import useSWR from 'swr'
import { apiClient } from '../../lib/api-client'
import { formatRelativeDate } from '../../lib/formatters'

export function SourceHealthPanel() {
  const { data, error, isLoading } = useSWR('sources', () => apiClient.getSources(), {
    revalidateOnFocus: false,
  })

  if (isLoading) {
    return (
      <div className="mb-4 card px-4 py-3 text-sm text-slate-400">
        Checking source health...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mb-4 rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
        Source health unavailable.
      </div>
    )
  }

  const sources = data.data
  const enabled = sources.filter((source) => source.enabled)
  const runnable = enabled.filter((source) => source.runnable)
  const missingAdapter = enabled.filter((source) => source.availabilityIssue?.startsWith('No adapter'))
  const blocked = enabled.filter((source) => source.availabilityIssue && !source.availabilityIssue.startsWith('No adapter'))
  const failing = enabled.filter((source) => source.failureCount > 0)
  const neverCrawled = enabled.filter((source) => !source.lastCrawledAt)
  const issues = [...missingAdapter, ...blocked, ...failing, ...neverCrawled]
    .filter((source, index, all) => all.findIndex((s) => s.id === source.id) === index)
    .slice(0, 8)

  return (
    <div className="mb-4 card">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-t-lg bg-slate-100 md:grid-cols-5">
        <Metric label="Sources" value={sources.length} />
        <Metric label="Enabled" value={enabled.length} />
        <Metric label="Runnable" value={runnable.length} />
        <Metric label="No adapter" value={missingAdapter.length} tone={missingAdapter.length > 0 ? 'warn' : 'ok'} />
        <Metric label="Failures" value={failing.length} tone={failing.length > 0 ? 'warn' : 'ok'} />
      </div>

      {issues.length > 0 ? (
        <div className="divide-y divide-slate-100">
          {issues.map((source) => (
            <div key={source.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1.5fr_1fr_1.5fr_1fr] md:items-center">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{source.name}</p>
                <p className="truncate text-xs text-slate-400">{source.domain}</p>
              </div>
              <p className="text-xs text-slate-500">
                {source.enabled ? source.ingestionMethod : 'disabled'}
                {source.failureCount > 0 ? ` · ${source.failureCount} failures` : ''}
              </p>
              <p className="text-xs text-amber-700">
                {source.availabilityIssue ?? (source.lastCrawledAt ? 'Recent crawl data missing' : 'Never crawled')}
              </p>
              <p className="text-xs text-slate-400 md:text-right">
                {source.lastCrawledAt ? formatRelativeDate(source.lastCrawledAt) : 'No crawl yet'}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-3 text-sm text-slate-500">All enabled sources are runnable with no recorded failures.</div>
      )}
    </div>
  )
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'ok' | 'warn' }) {
  const color = tone === 'warn' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : 'text-slate-900'

  return (
    <div className="bg-white px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  )
}
