'use client'

import useSWR from 'swr'
import { apiClient } from '../../../lib/api-client'
import { formatRelativeDate } from '../../../lib/formatters'
import { AppShell } from '../layout/AppShell'
import { SourceHealthPanel } from '../SourceHealthPanel'
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from '../ui'

/** Admin: host policies + circuits, boards needing attention, aggregator adapters. */
export function SourcesPage() {
  const { data, error, isLoading, mutate } = useSWR('health', () => apiClient.getHealth(), { refreshInterval: 60_000 })
  if (isLoading) return <AppShell title="Sources & hosts"><p className="text-sm text-slate-400">Loading…</p></AppShell>
  if (error || !data) return <AppShell title="Sources & hosts"><p className="text-sm text-rose-600">Health unavailable.</p></AppShell>
  return (
    <AppShell title="Sources & hosts" subtitle="Politeness per host · circuit breakers · boards · adapters">
      <PageHeader eyebrow="Admin" title="Sources & hosts" description="Every outbound fetch goes through the gateway: per-host rate limits, daily budgets, robots.txt and circuit breakers. Kill switches and resets live here." />
      <Card className="mb-6" padded={false}>
        <div className="p-5 pb-0"><CardHeader title="Hosts (last 15 minutes)" description="Requests by outcome, the policy in force and the circuit state." icon="server" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Host</th><th className="px-3 py-2">Req</th><th className="px-3 py-2">304</th><th className="px-3 py-2">changed</th><th className="px-3 py-2">429</th><th className="px-3 py-2">blocked</th><th className="px-3 py-2">errors</th><th className="px-3 py-2">Policy</th><th className="px-3 py-2">Circuit</th><th className="px-3 py-2"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.policies.map((p) => {
                const s = data.hosts.find((h) => h.host === p.host)
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-mono text-xs">{p.host}{!p.enabled && <Badge tone="danger" className="ml-2">disabled</Badge>}</td>
                    <td className="px-3 py-2 tabular-nums">{s?.total ?? 0}</td>
                    <td className="px-3 py-2 tabular-nums">{s?.unchanged ?? 0}</td>
                    <td className="px-3 py-2 tabular-nums">{s?.changed ?? 0}</td>
                    <td className={`px-3 py-2 tabular-nums ${s?.rateLimited ? 'text-amber-700' : ''}`}>{s?.rateLimited ?? 0}</td>
                    <td className={`px-3 py-2 tabular-nums ${s?.blocked ? 'font-semibold text-rose-700' : ''}`}>{s?.blocked ?? 0}</td>
                    <td className="px-3 py-2 tabular-nums">{(s?.errors ?? 0) + (s?.timeouts ?? 0)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{p.minIntervalMs} ms · {p.dailyBudget}/day</td>
                    <td className="px-3 py-2 text-xs"><Badge tone={p.circuitState === 'closed' ? 'success' : p.circuitState === 'open' ? 'danger' : 'warning'}>{p.circuitState}</Badge>{p.circuitOpenUntil ? ` → ${formatRelativeDate(p.circuitOpenUntil)}` : ''}{p.tripCount7d ? ` · ${p.tripCount7d} trips/7d` : ''}</td>
                    <td className="px-3 py-2"><div className="flex gap-1"><Button size="xs" onClick={async () => { await apiClient.patchHost(p.id, { enabled: !p.enabled }); mutate() }}>{p.enabled ? 'disable' : 'enable'}</Button>{p.circuitState !== 'closed' && <Button size="xs" onClick={async () => { await apiClient.patchHost(p.id, { resetCircuit: true }); mutate() }}>reset circuit</Button>}</div></td>
                  </tr>
                )
              })}
              {data.hosts.filter((h) => !data.policies.some((p) => p.host === h.host)).map((h) => (
                <tr key={h.host}><td className="px-4 py-2 font-mono text-xs">{h.host} <span className="text-slate-400">(default policy)</span></td><td className="px-3 py-2">{h.total}</td><td className="px-3 py-2">{h.unchanged}</td><td className="px-3 py-2">{h.changed}</td><td className="px-3 py-2">{h.rateLimited}</td><td className="px-3 py-2">{h.blocked}</td><td className="px-3 py-2">{h.errors + h.timeouts}</td><td colSpan={3}></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-6" padded={false}>
        <div className="p-5 pb-0"><CardHeader title="Boards needing attention" description="Blocked, failing or gone boards. Reset re-enables polling; blocked boards usually need a policy change first." icon="alert" /></div>
        {data.problemBoards.length === 0 ? <EmptyState icon="check" title="All boards healthy" /> : (
          <div className="divide-y divide-slate-100">
            {data.problemBoards.map((b) => (
              <div key={b.id} className="grid items-center gap-2 px-5 py-2.5 text-sm md:grid-cols-[1.5fr_1fr_1fr_2fr_auto]">
                <span className="font-medium">{b.company}</span>
                <span className="text-xs text-slate-500">{b.atsType}:{b.slug.slice(0, 40)}</span>
                <span><Badge tone={b.status === 'blocked' ? 'danger' : 'warning'}>{b.status}</Badge> <span className="text-xs text-slate-500">{b.consecutiveFailures} failures</span></span>
                <span className="truncate text-xs text-slate-500">{b.lastError ?? ''}</span>
                <Button size="xs" onClick={async () => { await apiClient.patchBoard(b.id, { status: 'active' }); mutate() }}>reset</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <CardHeader title="Aggregator sources" description="Legacy feed adapters (Remotive, WWR, …) and their availability." icon="list" />
      <SourceHealthPanel />
    </AppShell>
  )
}
