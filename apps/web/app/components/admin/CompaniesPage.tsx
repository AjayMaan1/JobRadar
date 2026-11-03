'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { apiClient, type CompanyRow } from '../../../lib/api-client'
import { AppShell } from '../layout/AppShell'
import { formatRelativeDate } from '../../../lib/formatters'
import { Badge, Button, Card, CardHeader, PageHeader } from '../ui'

const CLASS_SHORT: Record<string, string> = { p1_global_remote: 'P1', p2_india_remote: 'P2', p3_ncr_hybrid: 'P3', none: '—' }

export function CompaniesPage() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [tier, setTier] = useState('')
  const [anchorOnly, setAnchorOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [form, setForm] = useState({ name: '', careersUrl: '', hqCountry: '', anchor: false, mnc: false })
  const [adding, setAdding] = useState(false)

  const key = JSON.stringify({ q, status, tier, anchorOnly, page })
  const { data, mutate, isLoading } = useSWR(key, () => apiClient.getCompanies({ q, status, tier, anchor: anchorOnly ? 'true' : undefined, page: String(page) }), { revalidateOnFocus: false })

  async function patch(c: CompanyRow, p: Parameters<typeof apiClient.patchCompany>[1]) {
    await apiClient.patchCompany(c.id, p)
    mutate()
  }

  async function add() {
    if (!form.name || !form.careersUrl) return
    setAdding(true)
    try {
      await apiClient.addCompany({ name: form.name, careersUrl: form.careersUrl, hqCountry: form.hqCountry || undefined, anchor: form.anchor, tags: [...(form.anchor ? ['anchor'] : []), ...(form.mnc ? ['mnc'] : [])] })
      setForm({ name: '', careersUrl: '', hqCountry: '', anchor: false, mnc: false })
      mutate()
    } finally {
      setAdding(false)
    }
  }

  const rows = data?.data ?? []

  return (
    <AppShell title="Companies" subtitle={`${data?.total ?? 0} companies · polled by tier`}>
      <PageHeader eyebrow="Admin" title="Companies" description="The watchlist: every company we poll, its tier, pay band and boards. Tiers follow the union of users' preferences; anchors are never demoted for inactivity." />
      <Card className="mb-4">
        <CardHeader title="Add a company" description="Paste a careers URL — the resolver finds the ATS board and the prober verifies it before polling starts." icon="plus" />
        <div className="flex flex-wrap items-end gap-2">
          <input placeholder="Company name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input w-48" />
          <input placeholder="https://…/careers" value={form.careersUrl} onChange={(e) => setForm({ ...form, careersUrl: e.target.value })} className="input w-96" />
          <input placeholder="HQ (US)" value={form.hqCountry} onChange={(e) => setForm({ ...form, hqCountry: e.target.value.toUpperCase() })} className="input w-24" />
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={form.anchor} onChange={(e) => setForm({ ...form, anchor: e.target.checked })} /> anchor</label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={form.mnc} onChange={(e) => setForm({ ...form, mnc: e.target.checked })} /> MNC</label>
          <Button variant="primary" onClick={add} disabled={adding}>{adding ? 'Adding…' : 'Add'}</Button>
        </div>
      </Card>
      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          <input placeholder="Search name / domain" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} className="input w-64" />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="input w-auto">
            <option value="">All statuses</option>
            {['watched', 'probing', 'dormant', 'discovered', 'unresolved', 'retired', 'blocked'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={tier} onChange={(e) => { setTier(e.target.value); setPage(1) }} className="input w-auto">
            <option value="">All tiers</option>
            {['hot', 'warm', 'cold', 'dormant'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={anchorOnly} onChange={(e) => { setAnchorOnly(e.target.checked); setPage(1) }} /> anchors only</label>
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">HQ</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Best</th>
                <th className="px-3 py-2">Tier counts</th>
                <th className="px-3 py-2">30d</th>
                <th className="px-3 py-2">Pay (median)</th>
                <th className="px-3 py-2">Boards</th>
                <th className="px-3 py-2">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && <tr><td className="px-3 py-4 text-slate-400" colSpan={10}>Loading…</td></tr>}
              {rows.map((c) => {
                const cc = c.classCounts180d ?? {}
                return (
                  <tr key={c.id} className="align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{c.anchor ? '★ ' : ''}{c.name}</div>
                      <div className="text-xs text-slate-400">{c.domain ?? ''} · {c.discoveredVia}{c.tags?.length ? ` · ${c.tags.join(', ')}` : ''}</div>
                      {c.statusReason && <div className="text-xs text-amber-700">{c.statusReason}</div>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{c.hqCountry ?? '?'}</td>
                    <td className="px-3 py-2"><Badge tone={c.status === 'watched' ? 'success' : c.status === 'dormant' ? 'neutral' : c.status === 'blocked' ? 'danger' : 'warning'}>{c.status}</Badge></td>
                    <td className="px-3 py-2 text-slate-700">{c.manualTier ? `${c.manualTier} (manual)` : c.tier}</td>
                    <td className="px-3 py-2 font-medium">{CLASS_SHORT[c.bestClass] ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{cc.p1_global_remote ?? 0}/{cc.p2_india_remote ?? 0}/{cc.p3_ncr_hybrid ?? 0}</td>
                    <td className="px-3 py-2 text-slate-600">{c.postingRate30d}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {c.payMedianInr ? `₹${Math.round(c.payMedianInr / 100000)}L` : '—'}
                      <span className={`ml-1 text-xs ${c.payBandStatus === 'below_floor' ? 'text-rose-600' : c.payBandStatus === 'above_floor' ? 'text-emerald-600' : 'text-slate-400'}`}>{c.payBandStatus !== 'unknown' ? c.payBandStatus.replace('_', ' ') : ''}</span>
                    </td>
                    <td className="px-3 py-2">
                      {c.boards.length === 0 && <span className="text-xs text-slate-400">none</span>}
                      {c.boards.map((b) => (
                        <div key={b.id} className="text-xs text-slate-600">
                          <span className={b.status === 'active' ? 'text-emerald-600' : 'text-rose-600'}>●</span> {b.atsType}:{b.slug.slice(0, 30)} · {b.lastPostingCount} · {b.lastSuccessAt ? formatRelativeDate(b.lastSuccessAt) : 'never'}
                          {b.lastError ? <span className="text-rose-500"> · {b.lastError.slice(0, 40)}</span> : null}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button size="xs" onClick={() => patch(c, { anchor: !c.anchor })}>{c.anchor ? 'unanchor' : 'anchor'}</Button>
                        <select value={c.manualTier ?? ''} onChange={(e) => patch(c, { manualTier: (e.target.value || null) as never })} className="input input-sm w-auto">
                          <option value="">auto tier</option>
                          {['hot', 'warm', 'cold', 'dormant'].map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        {c.status !== 'dormant' ? (
                          <Button size="xs" variant="ghost" onClick={() => patch(c, { status: 'dormant' })}>mute</Button>
                        ) : (
                          <Button size="xs" variant="success" onClick={() => patch(c, { status: 'watched' })}>watch</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-center gap-3">
          {page > 1 && <Button onClick={() => setPage(page - 1)}>← Previous</Button>}
          {rows.length >= 50 && <Button onClick={() => setPage(page + 1)}>Next →</Button>}
        </div>
      </div>
    </AppShell>
  )
}
