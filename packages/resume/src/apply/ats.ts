/** Lightweight ATS detection for the Apply Kit (kept here so the web app doesn't depend on @jobradar/crawler). */
export type ApplyAts = 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters' | 'workday' | 'recruitee' | 'teamtailor' | 'bamboohr' | 'rippling' | 'personio' | 'linkedin' | 'other'

export function detectApplyAts(url: string | null | undefined): ApplyAts {
  if (!url) return 'other'
  const u = url.toLowerCase()
  if (u.includes('greenhouse.io')) return 'greenhouse'
  if (u.includes('lever.co')) return 'lever'
  if (u.includes('ashbyhq.com')) return 'ashby'
  if (u.includes('workable.com')) return 'workable'
  if (u.includes('smartrecruiters.com')) return 'smartrecruiters'
  if (u.includes('myworkdayjobs.com')) return 'workday'
  if (u.includes('recruitee.com')) return 'recruitee'
  if (u.includes('teamtailor.com')) return 'teamtailor'
  if (u.includes('bamboohr.com')) return 'bamboohr'
  if (u.includes('rippling.com')) return 'rippling'
  if (u.includes('personio.')) return 'personio'
  if (u.includes('linkedin.com')) return 'linkedin'
  return 'other'
}

/** What to expect on the employer's form — shown in the kit so the user knows what to paste where. */
export const ATS_NOTES: Record<ApplyAts, string> = {
  greenhouse: 'Greenhouse: resume upload + standard fields; custom questions below are pulled from the public posting. Attach the PDF (or DOCX) — the "Enter manually" path loses formatting.',
  lever: 'Lever: single-page form with resume upload and optional "Additional information"; LinkedIn URL is usually requested.',
  ashby: 'Ashby: upload resume first — it autofills name/email from the file; review each field before submitting.',
  workable: 'Workable: multi-step form; resume upload, then experience/education may be auto-parsed from it — check the parsed sections.',
  smartrecruiters: 'SmartRecruiters: resume upload with auto-parsing; cover letter is a separate field.',
  workday: 'Workday: account creation required; resume auto-parses into profile fields — verify dates and titles carefully.',
  recruitee: 'Recruitee: short form with resume upload.',
  teamtailor: 'Teamtailor: short form; LinkedIn connect optional.',
  bamboohr: 'BambooHR: standard form; resume and cover letter uploads.',
  rippling: 'Rippling ATS: standard form with resume upload.',
  personio: 'Personio: standard form; documents uploaded individually.',
  linkedin: 'LinkedIn Easy Apply: uses your LinkedIn profile plus an uploaded resume; keep the headline consistent with the resume you attach.',
  other: 'Company careers site: expect a standard form with resume upload. The final submit happens there.',
}
