'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient, type AlertChannel, type SessionRow } from '../../../lib/api-client'
import { Card as UiCard, CardHeader } from '../ui'

/**
 * Account section (audit NEW-07 / GH-6 / GH-7): password, active sessions, alert channels, data export and
 * account erasure. Everything here talks to per-user endpoints; nothing touches other users.
 */
export function AccountSettings({ email, isAdmin }: { email: string; isAdmin: boolean }) {
  return (
    <div className="space-y-6">
      <PasswordCard />
      <SessionsCard />
      <AlertChannelsCard isAdmin={isAdmin} />
      <ExtensionCard />
      <DataCard email={email} />
    </div>
  )
}

function Card({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: string; children: React.ReactNode }) {
  return (
    <UiCard>
      <CardHeader title={title} description={subtitle} icon={icon} />
      {children}
    </UiCard>
  )
}

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Card title="Password" subtitle="Changing it signs out every other device." icon="shield">
      <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setMsg(null)
        try { await apiClient.changePassword(current, next); setMsg({ ok: true, text: 'Password changed; other sessions revoked.' }); setCurrent(''); setNext('') }
        catch (err) { setMsg({ ok: false, text: (err as Error).message }) } finally { setBusy(false) }
      }}>
        <label className="text-xs text-slate-500">Current<input value={current} onChange={(e) => setCurrent(e.target.value)} type="password" autoComplete="current-password" className="input mt-1 block" /></label>
        <label className="text-xs text-slate-500">New (min 10)<input value={next} onChange={(e) => setNext(e.target.value)} type="password" autoComplete="new-password" minLength={10} required className="input mt-1 block" /></label>
        <button disabled={busy} className="btn btn-primary btn-sm">Change</button>
      </form>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
    </Card>
  )
}

function SessionsCard() {
  const [rows, setRows] = useState<SessionRow[]>([])
  const load = useCallback(() => apiClient.getSessions().then((r) => setRows(r.data)).catch(() => setRows([])), [])
  useEffect(() => { void load() }, [load])
  return (
    <Card title="Active sessions" subtitle="Where you are signed in. Revoke anything you don't recognise." icon="clock">
      <ul className="divide-y divide-slate-100 text-xs">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-1.5">
            <span className="truncate text-slate-700">{s.current && <span className="mr-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-700">this device</span>}{(s.userAgent ?? 'unknown client').slice(0, 70)} · {s.ip ?? '—'} · last seen {new Date(s.lastSeenAt).toLocaleString()}</span>
            {!s.current && <button onClick={async () => { await apiClient.revokeSession(s.id); await load() }} className="text-rose-600 hover:underline">revoke</button>}
          </li>
        ))}
        {!rows.length && <li className="py-1.5 text-slate-400">No sessions.</li>}
      </ul>
      {rows.length > 1 && <button onClick={async () => { await apiClient.revokeOtherSessions(); await load() }} className="mt-2 text-xs text-rose-600 hover:underline">Sign out everywhere else</button>}
    </Card>
  )
}

const CLASS_LABELS: Record<string, string> = { p1_global_remote: 'P1 global remote', p2_india_remote: 'P2 India remote', p3_ncr_hybrid: 'P3 NCR hybrid' }

function AlertChannelsCard({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<{ data: AlertChannel[]; providers: { telegram: boolean; email: boolean }; envFallback: boolean } | null>(null)
  const [kind, setKind] = useState<'telegram' | 'email'>('telegram')
  const [address, setAddress] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => apiClient.getAlertChannels().then(setData).catch(() => setData(null)), [])
  useEffect(() => { void load() }, [load])
  return (
    <Card title="Alerts" icon="bell" subtitle="Where new P1/P2 roles and the daily digest are delivered. Each user configures their own channels.">
      {data?.envFallback && isAdmin && <p className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">Using the TELEGRAM_CHAT_ID / EMAIL_TO from .env (owner fallback). Add a channel here to take control — required before enabling sign-up for others.</p>}
      <ul className="space-y-2 text-xs">
        {(data?.data ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-100 p-2">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium">{c.kind}</span>
            <span className="text-slate-700">{c.address}</span>
            {Object.keys(CLASS_LABELS).map((cls) => (
              <label key={cls} className="flex items-center gap-1 text-slate-600"><input type="checkbox" checked={c.classes.includes(cls)} onChange={async (e) => { await apiClient.patchAlertChannel(c.id, { classes: e.target.checked ? [...c.classes, cls] : c.classes.filter((x) => x !== cls) }); await load() }} />{CLASS_LABELS[cls]}</label>
            ))}
            <label className="flex items-center gap-1 text-slate-600">min score<input type="number" min={0} max={100} defaultValue={c.minScore} onBlur={async (e) => { await apiClient.patchAlertChannel(c.id, { minScore: Number(e.target.value) }); await load() }} className="input w-14" /></label>
            <label className="flex items-center gap-1 text-slate-600"><input type="checkbox" checked={c.instant} onChange={async (e) => { await apiClient.patchAlertChannel(c.id, { instant: e.target.checked }); await load() }} />instant</label>
            <label className="flex items-center gap-1 text-slate-600"><input type="checkbox" checked={c.digest} onChange={async (e) => { await apiClient.patchAlertChannel(c.id, { digest: e.target.checked }); await load() }} />digest</label>
            <label className="flex items-center gap-1 text-slate-600"><input type="checkbox" checked={c.enabled} onChange={async (e) => { await apiClient.patchAlertChannel(c.id, { enabled: e.target.checked }); await load() }} />enabled</label>
            <button onClick={async () => { await apiClient.deleteAlertChannel(c.id); await load() }} className="ml-auto text-rose-600 hover:underline">remove</button>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex flex-wrap items-center gap-2 text-xs" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await apiClient.addAlertChannel({ kind, address }); setAddress(''); await load() } catch (x) { setErr((x as Error).message) } }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as 'telegram')} className="input w-auto"><option value="telegram">Telegram chat id</option><option value="email">E-mail</option></select>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={kind === 'telegram' ? '123456789 (send /start to the bot, then /id)' : 'you@example.com'} className="input w-80" required />
        <button className="btn btn-primary btn-sm">Add</button>
        {data && !data.providers[kind] && <span className="text-amber-700">{kind === 'telegram' ? 'TELEGRAM_BOT_TOKEN' : 'SMTP'} is not configured on the server — delivery will fail until it is.</span>}
        {err && <span className="text-rose-600">{err}</span>}
      </form>
    </Card>
  )
}

function ExtensionCard() {
  const [tokens, setTokens] = useState<Array<{ id: string; createdAt: string; expiresAt: string }>>([])
  const [fresh, setFresh] = useState<{ token: string; baseUrl: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => apiClient.getExtensionTokens().then((r) => setTokens(r.data)).catch(() => setTokens([])), [])
  useEffect(() => { void load() }, [load])
  return (
    <Card title="Browser extension" icon="spark" subtitle="Autofills employer application forms (Greenhouse, Lever, Ashby, Workable, generic) with your profile, attaches the chosen resume version and pastes drafted answers. You still click Submit.">
      <ol className="mb-3 list-decimal pl-4 text-xs text-slate-600">
        <li>Load <code className="rounded bg-slate-100 px-1">apps/extension</code> as an unpacked extension (chrome://extensions → Developer mode → Load unpacked).</li>
        <li>Create a pairing token below and paste it, with this site&apos;s URL, into the extension&apos;s options page (Account → Browser extension).</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button onClick={async () => { setErr(null); try { const r = await apiClient.pairExtension(navigator.userAgent.slice(0, 40)); setFresh(r); await load() } catch (e) { setErr((e as Error).message) } }} className="btn btn-primary btn-sm">Create pairing token</button>
        {tokens.length > 0 && <button onClick={async () => { await apiClient.revokeExtensionToken(); setFresh(null); await load() }} className="text-rose-600 hover:underline">Revoke all ({tokens.length})</button>}
        {err && <span className="text-rose-600">{err}</span>}
      </div>
      {fresh && (
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs">
          <p className="mb-1 text-emerald-800">Copy now — it is shown once.</p>
          <div className="flex items-center gap-2"><span className="text-slate-500">URL</span><code className="rounded bg-white px-1.5 py-0.5">{fresh.baseUrl}</code></div>
          <div className="mt-1 flex items-center gap-2"><span className="text-slate-500">Token</span><code className="break-all rounded bg-white px-1.5 py-0.5">{fresh.token}</code><button onClick={() => navigator.clipboard.writeText(fresh.token)} className="link">copy</button></div>
        </div>
      )}
      <ul className="mt-2 divide-y divide-slate-100 text-xs">
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-1"><span className="text-slate-600">paired {new Date(t.createdAt).toLocaleString()} · expires {new Date(t.expiresAt).toLocaleDateString()}</span><button onClick={async () => { await apiClient.revokeExtensionToken(t.id); await load() }} className="text-rose-600 hover:underline">revoke</button></li>
        ))}
      </ul>
    </Card>
  )
}

function DataCard({ email }: { email: string }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Card title="Your data" icon="file" subtitle="Export everything as JSON (files as short-lived links), or erase the account — resumes, versions, reports, vectors and files included.">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <a href="/api/me/export" className="btn btn-secondary btn-sm">Download export</a>
        <form className="flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50/40 p-1.5" onSubmit={async (e) => { e.preventDefault(); if (confirm !== email) return; setBusy(true); try { await apiClient.deleteAccount(email); router.replace('/login'); router.refresh() } finally { setBusy(false) } }}>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`type ${email} to erase`} className="input input-sm w-72" />
          <button disabled={busy || confirm !== email} className="btn btn-danger btn-sm">Erase account</button>
        </form>
      </div>
    </Card>
  )
}
