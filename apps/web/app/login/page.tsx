import { Suspense } from 'react'
import { LoginForm } from '../components/LoginForm'
import { Icon } from '../components/ui/Icon'

export default function LoginPage() {
  return (
    <div className="grid min-h-screen grid-cols-1 bg-slate-50 lg:grid-cols-[5fr_4fr]">
      <div className="hidden flex-col justify-between bg-slate-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500"><Icon name="target" className="h-4 w-4" /></span><span className="text-lg font-semibold tracking-tight">JobRadar</span></div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Every posting, evaluated against <span className="text-indigo-300">your</span> preferences.</h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">Company boards polled every few minutes. Match scores against your resume, grounded suggestions, tailored versions, an apply kit and a browser autofill — nothing is changed or sent without you.</p>
          <ul className="mt-6 space-y-2 text-sm text-slate-300">
            {['Tiers, pay floor and home metros are yours to set', 'Your resume is masked before any AI processing', 'You always click Submit on the employer\'s site'].map((t) => <li key={t} className="flex items-center gap-2"><Icon name="check" className="h-4 w-4 text-emerald-400" />{t}</li>)}
          </ul>
        </div>
        <p className="text-xs text-slate-500">Self-hosted · your data stays on your box</p>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2 lg:hidden"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white"><Icon name="target" className="h-4 w-4" /></span><span className="text-lg font-semibold">JobRadar</span></div>
          <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
          <p className="mb-6 text-sm text-slate-500">Welcome back.</p>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
