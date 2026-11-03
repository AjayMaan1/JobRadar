'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { apiClient } from '../../../lib/api-client'
import { AppShell } from '../layout/AppShell'
import { Badge, Banner, Button, Card, CardHeader, PageHeader, Stat } from '../ui'

/** Admin overview (HLD-ui-v8 §3): alerts first, then worker / corpus / AI / preferences-engine tiles. */
export function OverviewPage() {
  const { data, error, isLoading, mutate } = useSWR('health', () => apiClient.getHealth(), { refreshInterval: 60_000 })
  const [crawling, setCrawling] = useState(false)
  async function refresh() { setCrawling(true); try { await apiClient.triggerCrawl(); setTimeout(() => mutate(), 45_000) } finally { setCrawling(false) } }

  if (isLoading) return <AppShell title="Overview"><p className="text-sm text-slate-400">Loading…</p></AppShell>
  if (error || !data) return <AppShell title="Overview"><p className="text-sm text-rose-600">Health unavailable.</p></AppShell>
  const c = data.counts
  const w = data.worker
  const ttd = data.timeToDetect.medianMinutes

  return (
    <AppShell title="Overview" subtitle="Worker · corpus · AI · preferences engine" actions={<Button variant="primary" size="sm" icon="activity" onClick={refresh} disabled={crawling}>{crawling ? 'Crawling…' : 'Crawl now'}</Button>}>
      <PageHeader eyebrow="Admin" title="Overview" description="One glance: is the worker alive, are boards healthy, is the corpus growing, is AI reachable." />
      {data.alerts.length > 0 && (
        <Banner tone={data.alerts.some((a) => /WORKER DOWN|BLOCKED/.test(a)) ? 'danger' : 'warning'}>
          <ul className="space-y-0.5">{data.alerts.map((a, i) => <li key={i}>⚠ {a}</li>)}</ul>
        </Banner>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Worker" value={w ? (w.mode === 'inline' ? 'inline' : w.alive ? 'alive' : 'DOWN') : 'n/a'} hint={w?.lastHeartbeatAt ? `heartbeat ${w.staleSec}s ago · ${w.version ?? ''}` : 'no heartbeat recorded'} tone={w?.alive || w?.mode === 'inline' ? 'success' : 'danger'} icon="activity" />
        <Stat label="Open eligible jobs" value={c.openJobs.toLocaleString()} hint={`${c.jobs24h} new in 24h (${c.p1_24h} / ${c.p2_24h} / ${c.p3_24h})`} icon="inbox" />
        <Stat label="Time to detect" value={ttd === null ? 'n/a' : `${Math.round(ttd)} min`} hint="median, board postings, 7 days" tone={ttd !== null && ttd < 30 ? 'success' : 'neutral'} icon="clock" />
        <Stat label="Boards" value={`${c.activeBoards} / ${c.boards}`} hint={`${c.blockedBoards} blocked · ${c.failingBoards} failing`} tone={c.blockedBoards ? 'warning' : 'neutral'} icon="server" />
        <Stat label="Companies watched" value={`${c.watched} / ${c.companies}`} hint={`${c.hot} hot · ${c.pendingDiscoveries} discoveries pending`} icon="building" />
        {data.v3 && (() => {
          const ai = data.v3.ai
          if (!ai || !ai.providers.length) return <Stat label="AI" value="off" hint="LLM_PROVIDER=none · deterministic features only" icon="spark" />
          const healthy = ai.providers.filter((p) => p.reachable !== false && !(p.detail && /quota/.test(p.detail)))
          const first = healthy[0]
          return <Stat label="AI" value={first ? first.name : 'down'} hint={first ? `${first.model ?? ''}${first.kind === 'cloud' && first.quota?.rpd ? ` · ${first.quota.usedToday}/${first.quota.rpd} today` : ''}${ai.providers.length > 1 ? ` · chain of ${ai.providers.length}` : ''} · ${data.v3.llm?.calls ?? 0} calls today` : 'deterministic features keep working'} tone={first ? (first.kind === 'local' ? 'success' : 'accent') : 'warning'} icon="spark" />
        })()}
        {data.v3 && <Stat label="Resumes / reports 24h" value={`${data.v3.resumes} / ${data.v3.reportsToday}`} hint={data.v3.embeddings ? `${data.v3.embeddings.jobs} jobs embedded · ${data.v3.embeddings.fits} fits` : ''} icon="file" />}
        {data.prefs && <Stat label="Preferences engine" value={data.prefs.engine} hint={`${data.prefs.activeUsers} active user(s) · ${data.prefs.evaluated.toLocaleString()} evaluations`} tone={data.prefs.engine === 'evals' ? 'success' : 'warning'} icon="sliders" />}
      </div>

      {data.prefs && (
        <Card className="mb-6">
          <CardHeader title="Crawl scope (union of users' preferences)" description="What the crawler follows: every user's home metros and countries, the intersection of excluded HQs, the lowest pay floor." icon="target" />
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="accent">countries: {data.prefs.scope.countries.join(', ') || '—'}</Badge>
            <Badge tone="accent">metros: {data.prefs.scope.metros.join(', ') || '—'}</Badge>
            <Badge>excluded HQs: {data.prefs.scope.excludedHqCountries.join(', ') || 'none'}</Badge>
            <Badge>pay floor: {data.prefs.scope.floorUsd === null ? 'none' : `$${Math.round(data.prefs.scope.floorUsd / 1000)}k`}</Badge>
          </div>
          {data.prefs.suggestions.length > 0 && (
            <div className="mt-3 space-y-2">
              {data.prefs.suggestions.map((sg) => (
                <div key={sg.metro} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><span>{sg.message}</span><Button size="xs" onClick={async () => { await apiClient.applyCrawlScope(sg.metro, sg.boardIds); mutate() }}>apply to {sg.boardIds.length} board(s)</Button></div>
              ))}
            </div>
          )}
        </Card>
      )}

      {data.anchorsWithoutEligible.length > 0 && <Banner tone="warning">Anchors with 0 eligible postings in 180 days: {data.anchorsWithoutEligible.map((a) => a.name).join(', ')}</Banner>}

      {data.v3?.ai && data.v3.ai.providers.length > 0 && (
        <Card>
          <CardHeader title="AI providers" description="Tried in this order per call. Resume-derived prompts (parse, suggest, headline, answers) only go to providers marked PII-ok; job descriptions may go anywhere. Quotas are the free-tier limits enforced client-side." icon="spark" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500"><tr><th className="py-1.5 pr-3">#</th><th className="py-1.5 pr-3">Provider</th><th className="py-1.5 pr-3">Model</th><th className="py-1.5 pr-3">Where</th><th className="py-1.5 pr-3">Data use</th><th className="py-1.5 pr-3">PII</th><th className="py-1.5 pr-3">Status</th><th className="py-1.5 pr-3">Quota today</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.v3.ai.providers.map((p, i) => (
                  <tr key={p.name}>
                    <td className="py-2 pr-3 text-slate-400">{i + 1}</td>
                    <td className="py-2 pr-3 font-medium text-slate-900">{p.name}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-slate-600">{p.model ?? '—'}</td>
                    <td className="py-2 pr-3"><Badge tone={p.kind === 'local' ? 'success' : 'info'}>{p.kind === 'local' ? 'this box' : 'cloud'}</Badge></td>
                    <td className="py-2 pr-3"><Badge tone={p.dataUse === 'local' ? 'success' : p.dataUse === 'no-train' ? 'neutral' : 'warning'}>{p.dataUse === 'local' ? 'stays local' : p.dataUse === 'no-train' ? 'no training' : 'may train'}</Badge></td>
                    <td className="py-2 pr-3">{p.piiAllowed ? <Badge tone="success">ok</Badge> : <Badge tone="warning" title="Only job descriptions are sent here (LLM_PII_PROVIDERS to override)">public only</Badge>}</td>
                    <td className="py-2 pr-3">{p.reachable === false ? <span className="text-rose-600">{p.detail ?? 'unreachable'}</span> : p.coolingDown ? <span className="text-amber-700">cooling down · {p.coolingDown}</span> : p.detail && /quota/.test(p.detail) ? <span className="text-amber-700">{p.detail}</span> : <span className="text-emerald-700">{p.reachable === null ? 'configured' : 'reachable'}{p.detail ? ` · ${p.detail}` : ''}</span>}</td>
                    <td className="py-2 pr-3 tabular-nums text-slate-600">{p.quota ? `${p.quota.usedToday}${p.quota.rpd ? ` / ${p.quota.rpd}` : ''} req · ${p.quota.rpm ? `${p.quota.rpm} rpm` : 'no rpm cap'}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">Change the order or add a hosted free tier with <code className="kbd">./jobradar ai setup</code> or <code className="kbd">LLM_PROVIDER=gemini,ollama</code> — see docs/AI-PROVIDERS.md.</p>
        </Card>
      )}

      {data.v3 && (
        <Card>
          <CardHeader title="User-task queues" description="waiting / active / failed — details and dead letters under Queues." icon="layers" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {(Object.entries(data.v3.queues) as Array<[string, { waiting: number; active: number; failed: number }]>).map(([name, q]) => (
              <div key={name} className="rounded-xl border border-slate-200 p-3"><div className="text-xs text-slate-500">{name}</div><div className={`mt-1 text-lg font-semibold tabular-nums ${q.failed ? 'text-amber-700' : 'text-slate-900'}`}>{q.waiting} / {q.active} / {q.failed}</div></div>
            ))}
          </div>
          {data.v3.llm && <p className="mt-3 text-xs text-slate-500">LLM today: {data.v3.llm.calls} calls · ${data.v3.llm.usd.toFixed(2)} · {Object.entries(data.v3.llm.byPurpose).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none yet'}</p>}
        </Card>
      )}
    </AppShell>
  )
}
