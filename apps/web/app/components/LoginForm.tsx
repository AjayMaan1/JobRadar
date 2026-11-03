'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

type Mode = 'login' | 'forgot' | 'reset' | 'verify'

/**
 * Sign-in plus the account-recovery flows (audit NEW-07): forgot password → e-mailed link → /login?reset=<token>;
 * e-mail verification → /login?verify=<token>.
 */
export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const resetToken = params.get('reset')
  const verifyToken = params.get('verify')
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : verifyToken ? 'verify' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const goNext = () => {
    const next = params.get('next')
    router.replace(next && next.startsWith('/') ? next : '/')
    router.refresh()
  }

  useEffect(() => {
    if (mode !== 'verify' || !verifyToken) return
    setBusy(true)
    fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verifyToken }) })
      .then(async (res) => { if (res.ok) goNext(); else { setError((await res.json().catch(() => ({}))).error ?? 'Verification failed'); setMode('login') } })
      .finally(() => setBusy(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, verifyToken])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setInfo(null)
    try {
      if (mode === 'login') {
        const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(body.retryAfterSec ? `${body.error} (${Math.ceil(body.retryAfterSec / 60)} min)` : body.error ?? 'Sign-in failed')
          return
        }
        goNext()
      } else if (mode === 'forgot') {
        const res = await fetch('/api/auth/reset-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) { setError(body.error ?? 'Request failed'); return }
        setInfo(body.message ?? 'Check your inbox.')
      } else if (mode === 'reset') {
        if (password !== password2) { setError('Passwords do not match'); return }
        const res = await fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, password }) })
        if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Reset failed'); return }
        setInfo('Password updated — sign in with your new password.')
        setMode('login'); setPassword(''); setPassword2('')
        router.replace('/login')
      }
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'verify') return <div className="card p-6 text-sm text-slate-600">{busy ? 'Verifying your e-mail…' : error ?? 'Verified.'}</div>

  return (
    <form onSubmit={submit} className="card space-y-4 p-6">
      {mode !== 'reset' && (
        <label className="label">Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required className="input mt-1" />
        </label>
      )}
      {mode === 'login' && (
        <label className="label">Password
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required className="input mt-1" />
        </label>
      )}
      {mode === 'reset' && (
        <>
          <label className="label">New password (min 10 characters)
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" minLength={10} required className="input mt-1" />
          </label>
          <label className="label">Repeat
            <input value={password2} onChange={(e) => setPassword2(e.target.value)} type="password" autoComplete="new-password" minLength={10} required className="input mt-1" />
          </label>
        </>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {info && <p className="text-xs text-emerald-700">{info}</p>}
      <button disabled={busy} className="btn btn-primary btn-md w-full">
        {busy ? 'Working…' : mode === 'login' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Set new password'}
      </button>
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        {mode === 'login' ? (
          <>
            <span>First run: set ADMIN_EMAIL and ADMIN_PASSWORD in .env.</span>
            <button type="button" onClick={() => { setMode('forgot'); setError(null); setInfo(null) }} className="link">Forgot password?</button>
          </>
        ) : (
          <button type="button" onClick={() => { setMode('login'); setError(null); setInfo(null) }} className="link">Back to sign in</button>
        )}
      </div>
    </form>
  )
}
