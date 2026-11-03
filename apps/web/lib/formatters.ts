import type { Job } from './api-client.js'

export function formatSalaryINR(job: Job): string {
  if (job.salaryInrMin && job.salaryInrMax) {
    const min = Math.round(job.salaryInrMin / 100000)
    const max = Math.round(job.salaryInrMax / 100000)
    return `₹${min}L–₹${max}L`
  }
  if (job.salaryMin && job.salaryCurrency) {
    const k = Math.round(job.salaryMin / 1000)
    return `${job.salaryCurrency} ${k}k+`
  }
  return 'Salary not listed'
}

export function formatSalaryOrig(job: Job): string {
  if (!job.salaryMin || !job.salaryCurrency) return ''
  const min = Math.round(job.salaryMin / 1000)
  const max = job.salaryMax ? Math.round(job.salaryMax / 1000) : null
  const period = job.salaryPeriod === 'month' ? '/mo' : '/yr'
  return max ? `${job.salaryCurrency} ${min}k–${max}k${period}` : `${job.salaryCurrency} ${min}k+${period}`
}

export function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown date'
  const date = new Date(dateStr)
  const diff = Date.now() - date.getTime()
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(hours / 24)

  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function scoreColor(score: number): string {
  if (score >= 80) return 'bg-emerald-50 text-emerald-700'
  if (score >= 60) return 'bg-amber-50 text-amber-700'
  if (score >= 40) return 'bg-orange-50 text-orange-700'
  return 'bg-slate-100 text-slate-600'
}

export function eligibilityColor(e: string): string {
  switch (e) {
    case 'india_allowed': return 'bg-emerald-50 text-emerald-700'
    case 'worldwide': return 'bg-sky-50 text-sky-700'
    case 'emea': return 'bg-violet-50 text-violet-700'
    case 'apac': return 'bg-indigo-50 text-indigo-700'
    case 'country_restricted': return 'bg-rose-50 text-rose-700'
    default: return 'bg-slate-100 text-slate-500'
  }
}

export function eligibilityLabel(e: string): string {
  switch (e) {
    case 'india_allowed': return '🇮🇳 India OK'
    case 'worldwide': return '🌍 Worldwide'
    case 'emea': return '🇪🇺 EMEA'
    case 'apac': return '🌏 APAC'
    case 'country_restricted': return '🔒 Restricted'
    default: return '❓ Unknown'
  }
}
