/**
 * .env handling for the launcher: parse, merge (comments and order preserved, unknown keys appended), and
 * first-run provisioning (secrets, admin credentials, AI provider block). Pure functions + one writer.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function parseEnv(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2]
    // strip trailing inline comment unless quoted
    if (v.startsWith('"') || v.startsWith("'")) { const q = v[0]; const end = v.indexOf(q, 1); v = end > 0 ? v.slice(1, end) : v.slice(1) }
    else { const hash = v.search(/\s+#/); if (hash >= 0) v = v.slice(0, hash); v = v.trim() }
    out[m[1]] = v
  }
  return out
}

/** Set keys in an env file text; existing lines are rewritten in place (comment kept), new keys appended under a header. */
export function mergeEnv(text, updates, header = '# ── added by ./jobradar ──') {
  const lines = text.split(/\r?\n/)
  const seen = new Set()
  const out = lines.map((raw) => {
    const m = raw.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/)
    if (!m || !(m[2] in updates)) return raw
    seen.add(m[2])
    const rest = m[4]
    const comment = rest.startsWith('"') || rest.startsWith("'") ? '' : (() => { const i = rest.search(/\s+#/); return i >= 0 ? rest.slice(i) : '' })()
    return `${m[1]}${m[2]}${m[3]}${quoteIfNeeded(updates[m[2]])}${comment}`
  })
  const missing = Object.keys(updates).filter((k) => !seen.has(k))
  if (missing.length) {
    if (out.length && out[out.length - 1] !== '') out.push('')
    out.push(header, ...missing.map((k) => `${k}=${quoteIfNeeded(updates[k])}`))
  }
  return out.join('\n') + (out[out.length - 1] === '' ? '' : '\n')
}

function quoteIfNeeded(v) {
  const s = String(v ?? '')
  return /[\s#"']/.test(s) ? JSON.stringify(s) : s
}

export const genSecret = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const genPassword = () => {
  // 16 chars, unambiguous alphabet, always ≥ 10 (MIN_PASSWORD_LENGTH)
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const b = randomBytes(16)
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('')
}

/** Keys that must be non-empty for a working install, with how the launcher fills them. */
export const REQUIRED = {
  DATABASE_URL: { default: 'postgresql://jobradar:jobradar@localhost:5432/jobradar' },
  REDIS_URL: { default: 'redis://localhost:6379' },
  STORAGE_SIGNING_SECRET: { generate: () => genSecret(32), secret: true },
  ADMIN_EMAIL: { prompt: 'Admin e-mail (your login)', default: 'owner@jobradar.local' },
  ADMIN_PASSWORD: { generate: genPassword, secret: true, showOnce: true },
  APP_URL: { default: 'http://localhost:3000' },
  CONTACT_EMAIL: { copyFrom: 'ADMIN_EMAIL' },
}

/**
 * Compute the updates needed to make `current` complete. Pure: returns { updates, generated } where `generated`
 * lists the secrets created (to print once). `answers` come from flags/prompts (e.g. { ADMIN_EMAIL }).
 */
export function provision(current, answers = {}) {
  const updates = {}
  const generated = []
  const value = (k) => updates[k] ?? current[k] ?? ''
  for (const [k, spec] of Object.entries(REQUIRED)) {
    if (answers[k]) { if (answers[k] !== current[k]) updates[k] = answers[k]; continue }
    if (value(k)) continue
    if (spec.generate) { updates[k] = spec.generate(); generated.push({ key: k, value: updates[k], showOnce: Boolean(spec.showOnce) }) }
    else if (spec.copyFrom) updates[k] = value(spec.copyFrom)
    else if (spec.default !== undefined) updates[k] = spec.default
  }
  return { updates, generated }
}

/** .env block for an AI choice (docs/AI-PROVIDERS.md §4). */
export function aiEnv(choice, keys = {}) {
  switch (choice) {
    case 'local': return { LLM_PROVIDER: 'ollama', EMBEDDING_PROVIDER: 'ollama' }
    case 'none': return { LLM_PROVIDER: 'none', EMBEDDING_PROVIDER: 'none' }
    case 'gemini': return { LLM_PROVIDER: 'gemini,ollama', EMBEDDING_PROVIDER: 'ollama', GEMINI_API_KEY: keys.GEMINI_API_KEY ?? '' }
    case 'groq': return { LLM_PROVIDER: 'groq,ollama', LLM_PII_PROVIDERS: 'groq', EMBEDDING_PROVIDER: 'ollama', GROQ_API_KEY: keys.GROQ_API_KEY ?? '' }
    case 'cerebras': return { LLM_PROVIDER: 'cerebras,ollama', LLM_PII_PROVIDERS: 'cerebras', EMBEDDING_PROVIDER: 'ollama', CEREBRAS_API_KEY: keys.CEREBRAS_API_KEY ?? '' }
    case 'mistral': return { LLM_PROVIDER: 'mistral,ollama', EMBEDDING_PROVIDER: 'ollama', MISTRAL_API_KEY: keys.MISTRAL_API_KEY ?? '' }
    case 'openrouter': return { LLM_PROVIDER: 'openrouter,ollama', EMBEDDING_PROVIDER: 'ollama', OPENROUTER_API_KEY: keys.OPENROUTER_API_KEY ?? '' }
    case 'fast': return { LLM_PROVIDER: 'cerebras,gemini,groq,none', LLM_PII_PROVIDERS: 'cerebras,gemini,groq', EMBEDDING_PROVIDER: 'gemini', CEREBRAS_API_KEY: keys.CEREBRAS_API_KEY ?? '', GEMINI_API_KEY: keys.GEMINI_API_KEY ?? '', GROQ_API_KEY: keys.GROQ_API_KEY ?? '' }
    case 'hybrid': return { LLM_PROVIDER: 'cerebras,groq,ollama', LLM_PII_PROVIDERS: 'cerebras,groq', EMBEDDING_PROVIDER: 'ollama', CEREBRAS_API_KEY: keys.CEREBRAS_API_KEY ?? '', GROQ_API_KEY: keys.GROQ_API_KEY ?? '' }
    case 'cloud-only': return { LLM_PROVIDER: 'cerebras,groq,none', LLM_PII_PROVIDERS: 'cerebras,groq', EMBEDDING_PROVIDER: 'none', CEREBRAS_API_KEY: keys.CEREBRAS_API_KEY ?? '', GROQ_API_KEY: keys.GROQ_API_KEY ?? '' }
    default: throw new Error(`unknown --ai choice "${choice}" (local | fast | hybrid | gemini | groq | cerebras | mistral | openrouter | cloud-only | none)`)
  }
}
export const AI_CHOICES = ['local', 'fast', 'hybrid', 'gemini', 'groq', 'cerebras', 'mistral', 'openrouter', 'cloud-only', 'none']
export const AI_KEYS_FOR = { fast: ['CEREBRAS_API_KEY', 'GEMINI_API_KEY'], hybrid: ['CEREBRAS_API_KEY', 'GROQ_API_KEY'], 'cloud-only': ['CEREBRAS_API_KEY', 'GROQ_API_KEY'] }
export const AI_KEY_FOR = { gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', cerebras: 'CEREBRAS_API_KEY', mistral: 'MISTRAL_API_KEY', openrouter: 'OPENROUTER_API_KEY' }

export function readEnvFile(root) {
  const p = join(root, '.env')
  if (!existsSync(p)) return { exists: false, text: '', values: {} }
  const text = readFileSync(p, 'utf8')
  return { exists: true, text, values: parseEnv(text) }
}

export function writeEnvFile(root, text) { writeFileSync(join(root, '.env'), text) }
