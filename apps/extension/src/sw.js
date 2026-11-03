import { applyKit, fetchFile, markApplied, me, ApiError } from './api.js'

/**
 * Service worker: owns the token, talks to JobRadar, keeps a per-tab kit cache and the toolbar badge.
 * Messages from popup/content: { type: 'kit' | 'fill' | 'attach' | 'applied' | 'me' | 'inventory' }.
 */
const kits = new Map() // tabId → { url, kit, at }
const KIT_TTL = 5 * 60_000

async function kitForTab(tabId, url, force = false) {
  const c = kits.get(tabId)
  if (!force && c && c.url === url && Date.now() - c.at < KIT_TTL) return c.kit
  const kit = await applyKit(url)
  kits.set(tabId, { url, kit, at: Date.now() })
  await badge(tabId, kit)
  return kit
}

async function badge(tabId, kit) {
  try {
    if (!kit) { await chrome.action.setBadgeText({ tabId, text: '' }); return }
    const text = kit.job ? (kit.resume && kit.resume.kind === 'tailored' ? '✓' : '•') : '○'
    await chrome.action.setBadgeText({ tabId, text })
    await chrome.action.setBadgeBackgroundColor({ tabId, color: kit.job ? '#10b981' : '#9ca3af' })
    await chrome.action.setTitle({ tabId, title: kit.job ? `JobRadar: ${kit.job.title} @ ${kit.job.company}` : 'JobRadar: no matching job (profile-only fill)' })
  } catch { /* tab gone */ }
}

function isAtsUrl(url) {
  return /greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com|apply\.workable\.com|localhost|127\.0\.0\.1/.test(url || '')
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url && isAtsUrl(tab.url)) kitForTab(tabId, tab.url).catch(() => badge(tabId, null))
})
chrome.tabs.onRemoved.addListener((tabId) => kits.delete(tabId))

async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg)
  } catch {
    // content script not injected yet (page opened before install) → inject and retry
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/fill-engine.js', 'src/content.js'] })
    return chrome.tabs.sendMessage(tabId, msg)
  }
}

/** Message handler (also exposed as globalThis.__jobradarHandle for the headless E2E harness). */
async function handle(msg, sender) {
  const tabId = msg.tabId ?? (sender && sender.tab && sender.tab.id)
  switch (msg.type) {
    case 'me': return { ok: true, data: await me() }
    case 'kit': {
      const tab = await chrome.tabs.get(tabId)
      return { ok: true, data: await kitForTab(tabId, tab.url, Boolean(msg.force)) }
    }
    case 'inventory': return { ok: true, data: await sendToTab(tabId, { type: 'inventory' }) }
    case 'fill': {
      const tab = await chrome.tabs.get(tabId)
      const kit = await kitForTab(tabId, tab.url)
      let file = null
      if (msg.attach !== false && kit.resume && (kit.resume.pdf || kit.resume.original)) {
        const f = kit.resume.pdf || kit.resume.original
        try { const d = await fetchFile(f.url); file = { name: f.filename, type: d.type, bytes: d.bytes } } catch (e) { file = { error: e.message } }
      }
      const report = await sendToTab(tabId, { type: 'fill', kit, file: file && !file.error ? file : null, onlyEmpty: Boolean(msg.onlyEmpty) })
      if (file && file.error) report.skipped.push({ key: 'resume', reason: `download failed: ${file.error}` })
      return { ok: true, data: report }
    }
    case 'applied': {
      const tab = await chrome.tabs.get(tabId)
      const kit = await kitForTab(tabId, tab.url)
      if (!kit.job) throw new Error('This page is not linked to a JobRadar job')
      const r = await markApplied({ jobId: kit.job.id, resumeVersionId: kit.resume ? kit.resume.versionId : null, answers: kit.answers.map((a) => ({ question: a.question, answer: a.answer })), coverNote: kit.coverNote, headlineUsed: kit.profile.headline, aboutUsed: kit.profile.about, followUpInDays: msg.followUpInDays })
      kits.delete(tabId)
      return { ok: true, data: r }
    }
    default: return { ok: false, error: `unknown message ${msg.type}` }
  }
}
globalThis.__jobradarHandle = (msg) => handle(msg, null).catch((e) => ({ ok: false, error: e.message, code: e instanceof ApiError ? e.code : undefined, status: e instanceof ApiError ? e.status : undefined }))

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  handle(msg, sender).then(respond, (e) => respond({ ok: false, error: e.message, code: e instanceof ApiError ? e.code : undefined, status: e instanceof ApiError ? e.status : undefined }))
  return true
})
