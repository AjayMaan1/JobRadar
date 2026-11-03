import type { Job } from '@jobradar/db'
import { log } from '@jobradar/log'
import { formatTelegramAlert } from './templates/job-alert.js'

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
}

/** Raw send to one chat (per-user channels, audit GH-6). Throws on API errors so callers can record failures. */
export async function sendTelegramMessage(chatId: string, text: string, opts: { markdown?: boolean } = {}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not configured')
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), ...(opts.markdown ? { parse_mode: 'Markdown' } : {}), disable_web_page_preview: !opts.markdown }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram API error ${res.status}: ${body.slice(0, 200)}`)
  }
}

export async function sendTelegramAlert(job: Job, score: number, chatId = process.env.TELEGRAM_CHAT_ID): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) {
    log.warn('Telegram not configured — skipping alert')
    return
  }
  await sendTelegramMessage(chatId, formatTelegramAlert(job, score), { markdown: true })
}

/**
 * Operator alert (blocked hosts, budget, worker down). Safe to call from the web tier (audit NEW-05): no DB,
 * no Redis, never throws. Dedupe is the caller's job (see `OpsAlerter`).
 */
export async function sendOpsTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_OPS_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return false
  try {
    await sendTelegramMessage(chatId, `⚙️ JobRadar ops\n${text}`)
    return true
  } catch (err) {
    log.warn('ops alert failed', { reason: (err as Error).message })
    return false
  }
}
