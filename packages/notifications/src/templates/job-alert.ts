import type { Job } from '@jobradar/db'

function formatSalary(job: Job): string {
  if (job.salaryInrMin && job.salaryInrMax) {
    const min = Math.round(job.salaryInrMin / 100000)
    const max = Math.round(job.salaryInrMax / 100000)
    const orig =
      job.salaryMin && job.salaryMax && job.salaryCurrency
        ? ` (${job.salaryCurrency} ${Math.round(job.salaryMin / 1000)}k–${Math.round(job.salaryMax / 1000)}k)`
        : ''
    return `₹${min}L–₹${max}L/yr${orig}`
  }
  if (job.salaryMin && job.salaryCurrency) {
    return `${job.salaryCurrency} ${Math.round(job.salaryMin / 1000)}k+`
  }
  return 'Not specified'
}

function eligibilityEmoji(e: string): string {
  switch (e) {
    case 'india_allowed': return '🇮🇳'
    case 'worldwide': return '🌍'
    case 'emea': return '🇪🇺'
    case 'apac': return '🌏'
    case 'country_restricted': return '🔒'
    default: return '❓'
  }
}

const CLASS_TAG: Record<string, string> = {
  p1_global_remote: '[P1] Global remote',
  p2_india_remote: '[P2] India remote',
  p3_ncr_hybrid: '[P3] NCR hybrid',
  none: '',
}

/** Legacy Telegram Markdown chokes on unbalanced _ * [ ] ` — strip them from free text. */
function clean(s: string | null | undefined): string {
  return String(s ?? '').replace(/[_*\[\]`]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function formatTelegramAlert(job: Job, score: number, personal?: { tier: string; label?: string | null; reasons?: string[] }): string {
  let parsedSkills: string[] = []
  try {
    parsedSkills = typeof job.skills === 'string' ? JSON.parse(job.skills) : (job.skills ?? [])
  } catch {
    parsedSkills = []
  }
  const skills = parsedSkills.slice(0, 5).join(', ')
  const region = [job.country, job.region].filter(Boolean).join(' / ') || 'Remote'
  const salary = formatSalary(job)
  const eligEmoji = eligibilityEmoji(job.eligibility)

  const TIER_TAG: Record<string, string> = { tier1: '[T1] Global remote', tier2: '[T2] Remote in your country', tier3: '[T3] Hybrid near you' }
  const tag = personal ? (personal.label ? `[${personal.tier.toUpperCase()}] ${personal.label}` : TIER_TAG[personal.tier] ?? `[${personal.tier}]`) : CLASS_TAG[String((job as any).opportunityClass ?? 'none')] || 'New role'
  const employment = String((job as any).employmentType ?? 'unknown')
  const reason = personal?.reasons?.length ? clean(personal.reasons.join(' · ')).slice(0, 140) : (job as any).classReason ? clean(String((job as any).classReason)).slice(0, 120) : ''

  return [
    `🚨 *${tag}*`,
    ``,
    `*${clean(job.title)}*`,
    `🏢 ${clean(job.company)}`,
    `📍 ${clean(region)}`,
    `🌐 ${job.remoteType === 'remote' ? 'Fully Remote' : job.remoteType}${employment !== 'unknown' ? ` · ${employment.replace('_', '-')}` : ''}`,
    `💰 ${salary}`,
    `${eligEmoji} Eligibility: ${job.eligibility.replace(/_/g, ' ')}`,
    reason ? `🧭 Why: ${reason}` : '',
    `🎯 Score: *${score}/100*`,
    skills ? `🛠 Skills: ${clean(skills)}` : '',
    job.seniority ? `📊 Level: ${job.seniority}` : '',
    `🕒 First seen: ${new Date((job as any).firstSeenAt ?? job.discoveredAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`,
    ``,
    `🔗 [Apply Now](${job.applyUrl ?? job.sourceUrl})`,
  ]
    .filter(Boolean)
    .join('\n')
}
