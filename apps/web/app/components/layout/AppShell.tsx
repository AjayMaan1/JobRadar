'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { apiClient } from '../../../lib/api-client'
import { Icon } from '../ui/Icon'

interface Me { id: string; email: string; name: string | null; role: string }

const FOR_YOU = [
  { href: '/', label: 'Inbox', icon: 'inbox', match: (p: string) => p === '/' },
  { href: '/applications', label: 'Applications', icon: 'briefcase' },
  { href: '/resumes', label: 'Resumes', icon: 'file', match: (p: string) => p.startsWith('/resumes') },
  { href: '/profile', label: 'Profile', icon: 'user' },
  { href: '/preferences', label: 'Preferences', icon: 'sliders' },
  { href: '/account', label: 'Account', icon: 'shield' },
]
const ADMIN = [
  { href: '/admin', label: 'Overview', icon: 'activity', match: (p: string) => p === '/admin' },
  { href: '/admin/companies', label: 'Companies', icon: 'building' },
  { href: '/admin/sources', label: 'Sources & hosts', icon: 'server' },
  { href: '/admin/queues', label: 'Queues', icon: 'layers' },
]

/**
 * Application shell (HLD-ui-v8 §1): left sidebar with "For you" and, for admins, "Admin"; slim top bar with
 * the page title and actions. Workspaces (Inbox, Editor) use `fullBleed` to take the whole viewport.
 */
export function AppShell({ children, title, subtitle, actions, fullBleed = false }: { children: React.ReactNode; title?: string; subtitle?: string; actions?: React.ReactNode; fullBleed?: boolean }) {
  const path = usePathname()
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { apiClient.me().then((r) => setMe(r.user)).catch(() => setMe(null)) }, [])
  const isAdmin = me?.role === 'admin'
  const { data: health } = useSWR(isAdmin ? 'shell-health' : null, () => apiClient.getHealth().catch(() => null), { refreshInterval: 60_000, revalidateOnFocus: false })
  const workerDown = Boolean(health && health.worker && health.worker.alive === false)

  const item = (l: { href: string; label: string; icon: string; match?: (p: string) => boolean }) => {
    const active = l.match ? l.match(path) : path === l.href || path.startsWith(l.href + '/')
    return (
      <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
        <Icon name={l.icon} className={`h-4 w-4 ${active ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
        <span className="sidebar-label">{l.label}</span>
      </Link>
    )
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-14 items-center gap-2 px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white"><Icon name="target" className="h-4 w-4" /></span>
          <span className="text-base font-semibold tracking-tight">JobRadar</span>
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
          <div>
            <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">For you</div>
            <div className="space-y-0.5">{FOR_YOU.map(item)}</div>
          </div>
          {isAdmin && (
            <div>
              <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Admin</div>
              <div className="space-y-0.5">{ADMIN.map(item)}</div>
            </div>
          )}
        </nav>
        <div className="border-t border-slate-200 p-3">
          {isAdmin && (
            <div className={`mb-2 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${workerDown ? 'bg-rose-50 text-rose-700' : 'text-slate-500'}`}>
              <span className={`h-2 w-2 rounded-full ${health?.worker ? (workerDown ? 'bg-rose-500' : 'bg-emerald-500') : 'bg-slate-300'}`} />
              {health?.worker ? (workerDown ? 'worker down' : health.worker.mode === 'inline' ? 'inline worker' : 'worker alive') : 'worker status…'}
            </div>
          )}
          {me && (
            <div className="flex items-center gap-2 px-1">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">{(me.name ?? me.email).slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-slate-800">{me.name ?? me.email}</div>
                <div className="truncate text-[11px] text-slate-400">{me.name ? me.email : me.role}</div>
              </div>
              <button title="Sign out" onClick={async () => { await apiClient.logout(); router.replace('/login') }} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Icon name="logout" /></button>
            </div>
          )}
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/20 lg:hidden" onClick={() => setOpen(false)} />}

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-6">
          <button className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
          <div className="min-w-0">
            {title && <h1 className="truncate text-sm font-semibold text-slate-900">{title}</h1>}
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
        {!isAdmin && workerDown && null}
        <main className={fullBleed ? 'min-h-0 flex-1 p-3 lg:p-4' : 'mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8'}>{children}</main>
      </div>
    </div>
  )
}
