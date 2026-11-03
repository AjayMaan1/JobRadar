/** JobRadar API client for the service worker / options page (bearer token from chrome.storage.local). */
export async function getConfig() {
  const { baseUrl = '', token = '' } = await chrome.storage.local.get(['baseUrl', 'token'])
  return { baseUrl: String(baseUrl).replace(/\/$/, ''), token: String(token) }
}

export async function setConfig(cfg) {
  await chrome.storage.local.set({ baseUrl: String(cfg.baseUrl || '').replace(/\/$/, ''), token: String(cfg.token || '') })
}

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code }
}

export async function api(path, init = {}) {
  const { baseUrl, token } = await getConfig()
  if (!baseUrl || !token) throw new ApiError(0, 'Not paired — open the extension options and paste your JobRadar URL + token', 'unpaired')
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } })
  if (res.status === 204) return null
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { error: text.slice(0, 200) } }
  if (!res.ok) throw new ApiError(res.status, (body && body.error) || `HTTP ${res.status}`, body && body.code)
  return body
}

export const me = () => api('/api/ext/me')
export const applyKit = (url) => api(`/api/ext/apply-kit?url=${encodeURIComponent(url)}`)
export const markApplied = (payload) => api('/api/ext/applied', { method: 'POST', body: JSON.stringify(payload) })

/** Download a signed file as bytes (the local storage driver needs the bearer; S3 presigned links don't mind it). */
export async function fetchFile(url) {
  const { baseUrl, token } = await getConfig()
  const abs = url.startsWith('http') ? url : `${baseUrl}${url}`
  const res = await fetch(abs, { headers: abs.startsWith(baseUrl) ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new ApiError(res.status, `file download failed (${res.status})`)
  const buf = await res.arrayBuffer()
  return { bytes: Array.from(new Uint8Array(buf)), type: res.headers.get('content-type') || 'application/pdf' }
}
