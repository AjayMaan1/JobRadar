'use client'

import { Icon } from './Icon'

/** Design-system primitives (HLD-ui-v8 §2). Keep this file the single vocabulary for layout and controls. */

export function PageHeader({ eyebrow, title, description, actions, children }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-indigo-600">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ className = '', children, padded = true }: { className?: string; children: React.ReactNode; padded?: boolean }) {
  return <section className={`card ${padded ? 'p-5' : ''} ${className}`}>{children}</section>
}

export function CardHeader({ title, description, actions, icon }: { title: string; description?: string; actions?: React.ReactNode; icon?: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon && <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><Icon name={icon} /></span>}
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type Size = 'xs' | 'sm' | 'md'
export function Button({ variant = 'secondary', size = 'md', icon, className = '', children, ...rest }: { variant?: Variant; size?: Size; icon?: string; className?: string; children?: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon && <Icon name={icon} className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />}
      {children}
    </button>
  )
}

export function LinkButton({ href, variant = 'secondary', size = 'md', icon, className = '', children, ...rest }: { href: string; variant?: Variant; size?: Size; icon?: string; className?: string; children?: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon && <Icon name={icon} className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />}
      {children}
    </a>
  )
}

const TONES: Record<string, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
  accent: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
  info: 'border-sky-200 bg-sky-50 text-sky-700',
  violet: 'border-violet-200 bg-violet-50 text-violet-700',
}
export function Badge({ tone = 'neutral', className = '', children, title }: { tone?: keyof typeof TONES | string; className?: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`badge ${TONES[tone] ?? TONES.neutral} ${className}`}>{children}</span>
}

export function SegmentedControl<T extends string>({ value, options, onChange, size = 'sm' }: { value: T; options: Array<{ id: T; label: string; count?: number }>; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`rounded-md font-medium transition ${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} ${value === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
          {o.label}{o.count !== undefined && <span className="ml-1 text-[10px] text-slate-400">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, hint, tone = 'neutral', icon }: { label: string; value: React.ReactNode; hint?: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent'; icon?: string }) {
  const color = { neutral: 'text-slate-900', success: 'text-emerald-700', warning: 'text-amber-700', danger: 'text-rose-700', accent: 'text-indigo-700' }[tone]
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs text-slate-500">{label}{icon && <Icon name={icon} className="h-4 w-4 text-slate-300" />}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  )
}

export function EmptyState({ icon = 'inbox', title, body, action }: { icon?: string; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Icon name={icon} className="h-6 w-6" /></span>
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      {body && <p className="mt-1 max-w-md text-sm text-slate-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: React.ReactNode; action?: React.ReactNode }) {
  const t = { info: 'border-sky-200 bg-sky-50 text-sky-900', warning: 'border-amber-200 bg-amber-50 text-amber-900', danger: 'border-rose-200 bg-rose-50 text-rose-900', success: 'border-emerald-200 bg-emerald-50 text-emerald-900' }[tone]
  return <div className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${t}`}><div>{children}</div>{action}</div>
}

export function Drawer({ open, onClose, title, children, width = 'max-w-3xl' }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; width?: string }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className={`absolute inset-y-0 right-0 flex w-full ${width} flex-col bg-white shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><span className="text-sm font-semibold">{title}</span><Button variant="ghost" size="sm" icon="x" onClick={onClose}>Close</Button></div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}

export function Skeleton({ className = 'h-4 w-32' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />
}

export { Icon }
