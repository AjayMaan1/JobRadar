'use client'

import Link from 'next/link'

/** First-run checklist shown instead of an empty, confusing list (U10). */
export function GettingStarted({ hasResume, hasProfile, hasJobs }: { hasResume: boolean; hasProfile: boolean; hasJobs: boolean }) {
  const steps = [
    { done: hasResume, title: 'Upload your resume', body: 'PDF or DOCX. We parse it into a structured master copy you verify once.', href: '/resumes' },
    { done: hasProfile, title: 'Check your profile', body: 'Headline, target titles and skills drive the match score and the feed ranking.', href: '/profile' },
    { done: true, title: 'Set your preferences', body: 'Home, work modes, tiers and pay floor decide what lands in your inbox and when you are alerted.', href: '/preferences' },
    { done: hasJobs, title: 'Wait for jobs', body: 'The worker polls company boards every few minutes; new postings appear here with a match score.', href: null },
  ]
  return (
    <div className="m-4 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-base font-semibold text-slate-900">Get started</h2>
      <p className="mb-4 text-sm text-slate-500">A few steps and every job gets a match score, a missing-skill list and a tailored resume on request.</p>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{s.done ? '✓' : i + 1}</span>
            <div>
              <p className={`text-sm font-medium ${s.done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{s.title}</p>
              <p className="text-xs text-slate-500">{s.body}</p>
              {!s.done && s.href && <Link href={s.href} className="mt-1 inline-block link text-xs">Go →</Link>}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[11px] text-slate-400">Nothing in your resume is ever changed without your explicit approval, and contact details are masked before any AI processing.</p>
    </div>
  )
}
