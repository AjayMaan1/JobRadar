import nodemailer from 'nodemailer'
import type { Job } from '@jobradar/db'
import { log } from '@jobradar/log'
import { formatDigestEmail } from './templates/daily-digest.js'

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT ?? '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  })
}

export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && (process.env.SMTP_USER || process.env.EMAIL_FROM))
}

export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!emailConfigured()) throw new Error('SMTP not configured')
  await createTransport().sendMail({ from: process.env.EMAIL_FROM ?? process.env.SMTP_USER, to, subject, text, html })
}

export async function sendDailyDigest(jobs: Job[], to = process.env.EMAIL_TO): Promise<void> {
  if (!emailConfigured() || !to) {
    log.warn('Email not configured — skipping digest')
    return
  }
  const { subject, html, text } = formatDigestEmail(jobs)
  await sendMail(to, subject, text, html)
}

/** Transactional auth mail (audit NEW-07): reset / verify links. Plain text on purpose — no tracking, no HTML. */
export async function sendAuthEmail(to: string, kind: 'reset' | 'verify', link: string): Promise<void> {
  const subject = kind === 'reset' ? 'JobRadar — reset your password' : 'JobRadar — verify your e-mail'
  const text = kind === 'reset'
    ? `Someone asked to reset the password for this JobRadar account.\n\nReset it here (valid for 30 minutes, single use):\n${link}\n\nIf that wasn't you, ignore this message — nothing changes.`
    : `Welcome to JobRadar. Confirm your e-mail address to sign in (valid for 24 hours):\n${link}`
  if (!emailConfigured()) {
    // Dev without SMTP: print the link so the flow is still testable.
    log.warn(`SMTP not configured — ${kind} link for ${to.replace(/(.).+(@.*)/, '$1***$2')}: ${link}`)
    return
  }
  await sendMail(to, subject, text)
}

/** Follow-up reminder (GH-5). */
export async function sendFollowUpEmail(to: string, items: Array<{ title: string; company: string; appliedAt: Date | null; url: string | null }>): Promise<void> {
  const lines = items.map((i) => `• ${i.title} @ ${i.company}${i.appliedAt ? ` (applied ${i.appliedAt.toISOString().slice(0, 10)})` : ''}${i.url ? `\n  ${i.url}` : ''}`)
  await sendMail(to, `JobRadar — ${items.length} application${items.length === 1 ? '' : 's'} due for a follow-up`, `These applications are due for a follow-up today:\n\n${lines.join('\n')}\n\nOpen JobRadar → Applied tab to update their status.`)
}
