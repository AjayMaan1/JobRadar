'use client'

import useSWR from 'swr'
import { apiClient, type QueueInfo } from '../../lib/api-client'

/** Admin queue / dead-letter panel (GH-3): counts per queue, recent failures with retry / remove / clean. */
export function QueuesPanel() {
  const { data, error, mutate } = useSWR('admin-queues', () => apiClient.getQueues(), { refreshInterval: 30_000 })
  if (error) return <p className="mb-4 text-xs text-rose-600">Queue inspection unavailable (Redis down?).</p>
  if (!data) return null
  const failing = data.queues.filter((q) => q.failed.length)
  return (
    <div className="mb-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Queues {data.mode === 'inline' && <span className="text-xs font-normal text-slate-400">(inline mode — no Redis)</span>}</h2>
      <div className="overflow-x-auto card">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2">Queue</th><th className="px-3 py-2">waiting</th><th className="px-3 py-2">active</th><th className="px-3 py-2">delayed</th><th className="px-3 py-2">failed</th><th className="px-3 py-2">completed (kept)</th><th className="px-3 py-2"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data.queues.map((q) => (
              <tr key={q.name}>
                <td className="px-3 py-1.5 font-medium text-slate-800">{q.name}</td>
                <td className="px-3 py-1.5">{q.counts.waiting ?? 0}</td>
                <td className="px-3 py-1.5">{q.counts.active ?? 0}</td>
                <td className="px-3 py-1.5">{q.counts.delayed ?? 0}</td>
                <td className={`px-3 py-1.5 ${q.counts.failed ? 'font-semibold text-amber-700' : ''}`}>{q.counts.failed ?? 0}</td>
                <td className="px-3 py-1.5 text-slate-400">{q.counts.completed ?? 0}</td>
                <td className="px-3 py-1.5 text-right">{q.counts.failed ? <button onClick={async () => { if (confirm(`Remove all failed jobs on ${q.name}?`)) { await apiClient.queueAction(q.name, 'clean'); mutate() } }} className="text-rose-600 hover:underline">clean failed</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {failing.map((q) => <FailedList key={q.name} q={q} onChanged={() => mutate()} />)}
    </div>
  )
}

function FailedList({ q, onChanged }: { q: QueueInfo; onChanged: () => void }) {
  return (
    <details className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
      <summary className="cursor-pointer font-medium text-amber-900">{q.name}: {q.failed.length} recent failure{q.failed.length === 1 ? '' : 's'}</summary>
      <ul className="mt-2 space-y-1">
        {q.failed.map((j) => (
          <li key={j.id} className="flex flex-wrap items-center gap-2 rounded bg-white p-1.5">
            <span className="font-mono text-[10px] text-slate-400">{j.id}</span>
            <span className="text-slate-700">{j.name}</span>
            <span className="text-slate-500">attempts {j.attemptsMade}</span>
            {j.finishedOn && <span className="text-slate-400">{new Date(j.finishedOn).toLocaleString()}</span>}
            <span className="basis-full truncate text-rose-700" title={j.failedReason}>{j.failedReason}</span>
            <span className="text-slate-400">data: {j.dataKeys.join(', ')}</span>
            <span className="ml-auto flex gap-2">
              <button onClick={async () => { if (j.id) { await apiClient.queueAction(q.name, 'retry', j.id); onChanged() } }} className="link">retry</button>
              <button onClick={async () => { if (j.id) { await apiClient.queueAction(q.name, 'remove', j.id); onChanged() } }} className="text-rose-600 hover:underline">remove</button>
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
