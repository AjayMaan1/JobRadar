import type { Job } from '@jobradar/db'

function formatSalaryShort(job: Job): string {
  if (job.salaryInrMin) {
    return `₹${Math.round(job.salaryInrMin / 100000)}L+`
  }
  if (job.salaryMin && job.salaryCurrency) {
    return `${job.salaryCurrency}${Math.round(job.salaryMin / 1000)}k+`
  }
  return '—'
}

const CLASS_LABEL: Record<string, string> = {
  p1_global_remote: 'P1 · Global remote',
  p2_india_remote: 'P2 · India remote',
  p3_ncr_hybrid: 'P3 · Delhi-NCR hybrid',
  none: 'Other',
}

export function formatDigestEmail(jobs: Job[]): { subject: string; html: string; text: string } {
  const counts = jobs.reduce<Record<string, number>>((acc, j) => {
    const k = String((j as any).opportunityClass ?? 'none')
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${CLASS_LABEL[k] ?? k}`).join(' · ')
  const subject = `JobRadar Digest — ${jobs.length} new roles (${summary})`

  const rows = jobs
    .map(
      (job, i) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${CLASS_LABEL[String((job as any).opportunityClass ?? 'none')] ?? ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${i + 1}. <strong>${job.title}</strong>${String((job as any).employmentType) === 'contract' ? ' <em>(contract)</em>' : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${job.company}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${job.region ?? job.country ?? 'Remote'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${formatSalaryShort(job)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;"><strong>${Math.round(job.rankingScore)}</strong></td>
      <td style="padding:8px;border-bottom:1px solid #eee;">
        <a href="${job.applyUrl ?? job.sourceUrl}" style="color:#2563eb;">Apply</a>
      </td>
    </tr>`
    )
    .join('')

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:20px;">
  <h2 style="color:#1e293b;">JobRadar Daily Digest</h2>
  <p style="color:#64748b;">${jobs.length} new roles first seen in the last 24 hours — ${summary}</p>
  <table style="width:100%;border-collapse:collapse;">
    <thead>
      <tr style="background:#f1f5f9;text-align:left;">
        <th style="padding:8px;">Class</th>
        <th style="padding:8px;">Role</th>
        <th style="padding:8px;">Company</th>
        <th style="padding:8px;">Region</th>
        <th style="padding:8px;">Salary</th>
        <th style="padding:8px;">Score</th>
        <th style="padding:8px;">Link</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="color:#94a3b8;font-size:12px;margin-top:24px;">JobRadar — personal job intelligence engine</p>
</body>
</html>`

  const text = jobs
    .map(
      (job, i) =>
        `${i + 1}. [${CLASS_LABEL[String((job as any).opportunityClass ?? 'none')] ?? ''}] ${job.title} — ${job.company} — Score ${Math.round(job.rankingScore)} — ${formatSalaryShort(job)} — ${job.applyUrl ?? job.sourceUrl}`
    )
    .join('\n')

  return { subject, html, text }
}
