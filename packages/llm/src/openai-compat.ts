import { zodToJsonSchema } from 'zod-to-json-schema'
import type { JsonRequest, JsonResult, LlmProvider } from './types.js'
import { LlmError } from './types.js'
import { extractJson, validate } from './json.js'
import { PRESETS, type DataUse, type ProviderPreset } from './presets.js'
export { PII_PURPOSES, PRESETS } from './presets.js'
export type { DataUse, ProviderPreset } from './presets.js'

/**
 * One adapter for every hosted model behind an OpenAI-compatible `/chat/completions` endpoint
 * (docs/AI-PROVIDERS.md §4). Presets carry the base URL, default model, free-tier limits and — importantly —
 * the provider's data-use class, which the chain uses to keep resume-derived prompts away from providers
 * that train on free-tier inputs.
 */
export interface QuotaState { minute: { at: number; n: number }; day: { date: string; n: number; tokens: number } }

/**
 * Client-side free-tier guard: a per-minute window and a per-UTC-day counter. Exceeding either throws a
 * non-retryable `budget` error so the chain moves to the next provider instead of hammering a 429.
 */
export class QuotaLimiter {
  state: QuotaState = { minute: { at: 0, n: 0 }, day: { date: '', n: 0, tokens: 0 } }
  constructor(readonly rpm: number, readonly rpd: number, private now: () => number = Date.now) {}
  private roll() {
    const t = this.now()
    if (t - this.state.minute.at >= 60_000) this.state.minute = { at: t, n: 0 }
    const date = new Date(t).toISOString().slice(0, 10)
    if (this.state.day.date !== date) this.state.day = { date, n: 0, tokens: 0 }
  }
  /** Returns the ms to wait for the minute window, or -1 when the day is exhausted. */
  check(): number {
    this.roll()
    if (this.rpd > 0 && this.state.day.n >= this.rpd) return -1
    if (this.rpm > 0 && this.state.minute.n >= this.rpm) return Math.max(1, 60_000 - (this.now() - this.state.minute.at))
    return 0
  }
  record(tokens = 0) { this.roll(); this.state.minute.n++; this.state.day.n++; this.state.day.tokens += tokens }
  snapshot() { this.roll(); return { rpm: this.rpm, rpd: this.rpd, usedMinute: this.state.minute.n, usedToday: this.state.day.n, tokensToday: this.state.day.tokens } }
}

export interface OpenAICompatOptions {
  preset: ProviderPreset
  apiKey: string
  model?: string
  baseUrl?: string
  rpm?: number
  rpd?: number
  tpm?: number
  /** Metering: free tier → 0 cost. */
  free?: boolean
  maxRetries?: number
  fetchImpl?: typeof fetch
  now?: () => number
  sleepImpl?: (ms: number) => Promise<void>
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class OpenAICompatProvider implements LlmProvider {
  readonly name: string
  readonly preset: ProviderPreset
  readonly model: string
  readonly dataUse: DataUse
  readonly quota: QuotaLimiter
  private readonly baseUrl: string
  private readonly tpm: number
  private readonly free: boolean
  private readonly maxRetries: number
  private readonly fetchImpl: typeof fetch
  private readonly sleepImpl: (ms: number) => Promise<void>
  /** Set after a 401/403 so the chain skips us without another round-trip. */
  disabledReason: string | null = null

  constructor(private readonly opts: OpenAICompatOptions) {
    if (!opts.apiKey) throw new LlmError(`${opts.preset.keyEnv} is not set`, 'config')
    this.preset = opts.preset
    this.name = opts.preset.id
    this.model = opts.model ?? opts.preset.model
    this.baseUrl = (opts.baseUrl ?? opts.preset.baseUrl).replace(/\/$/, '')
    this.dataUse = opts.preset.dataUse
    this.quota = new QuotaLimiter(opts.rpm ?? opts.preset.rpm, opts.rpd ?? opts.preset.rpd, opts.now)
    this.tpm = opts.tpm ?? opts.preset.tpm
    this.free = opts.free ?? (opts.preset.rpm > 0 || opts.preset.rpd > 0)
    this.maxRetries = opts.maxRetries ?? 2
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.sleepImpl = opts.sleepImpl ?? sleep
  }

  /** Keep a single request under the provider's tokens-per-minute cap (≈ 4 chars/token, leave room for the answer). */
  private capPrompt(user: string, maxTokens: number): string {
    if (!this.tpm) return user
    const budgetChars = Math.max(2000, (this.tpm - maxTokens - 800) * 4)
    if (user.length <= budgetChars) return user
    const head = user.slice(0, Math.floor(budgetChars * 0.8))
    const tail = user.slice(-Math.floor(budgetChars * 0.15))
    return `${head}\n[… ${user.length - budgetChars} characters omitted to fit the provider's token limit …]\n${tail}`
  }

  async completeJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    if (this.disabledReason) throw new LlmError(`${this.name}: ${this.disabledReason}`, 'config')
    const wait = this.quota.check()
    if (wait < 0) throw new LlmError(`${this.name}: free-tier daily quota (${this.quota.rpd} requests) exhausted`, 'budget')
    if (wait > 0) {
      if (wait > 20_000) throw new LlmError(`${this.name}: per-minute quota reached (${this.quota.rpm} rpm)`, 'budget')
      await this.sleepImpl(wait)
    }
    const schema = zodToJsonSchema(req.schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>
    delete schema.$schema
    const schemaName = (req.schemaName ?? 'result').replace(/[^a-zA-Z0-9_-]/g, '_')
    const maxTokens = req.maxTokens ?? 2048
    const system = this.preset.structured === 'json_schema'
      ? req.system
      : `${req.system}\n\nRespond with a single JSON object that matches this JSON Schema exactly. No prose, no markdown.\n${JSON.stringify(schema)}`
    const body: Record<string, unknown> = {
      model: this.model,
      temperature: req.temperature ?? 0,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: this.capPrompt(req.user, maxTokens) }],
    }
    if (this.preset.structured === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: schemaName, schema } }
    else if (this.preset.structured === 'json_object') body.response_format = { type: 'json_object' }

    const started = Date.now()
    let attempt = 0
    for (;;) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 90_000)
      let res: Response
      try {
        res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}`, ...(this.preset.id === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/jobradar', 'X-Title': 'JobRadar' } : {}) },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        })
      } catch (err) {
        clearTimeout(timer)
        const aborted = (err as Error).name === 'AbortError'
        if (!aborted && attempt < this.maxRetries) { attempt++; await this.sleepImpl(500 * 2 ** attempt); continue }
        throw new LlmError(aborted ? `${this.name} timed out` : `${this.name} unreachable: ${(err as Error).message}`, aborted ? 'timeout' : 'http', true)
      }
      clearTimeout(timer)
      if (res.status === 401 || res.status === 403) {
        this.disabledReason = `API key rejected (HTTP ${res.status}) — check ${this.preset.keyEnv}`
        throw new LlmError(`${this.name}: ${this.disabledReason}`, 'config')
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = parseFloat(res.headers.get('retry-after') ?? '')
        if (res.status === 429 && (retryAfter > 20 || attempt >= this.maxRetries)) {
          // the provider is throttling harder than our client-side quota expected: pretend the minute is spent
          this.quota.state.minute.n = Math.max(this.quota.state.minute.n, this.quota.rpm || 1)
          throw new LlmError(`${this.name}: rate limited (429${retryAfter ? `, retry after ${retryAfter}s` : ''})`, 'budget')
        }
        if (attempt < this.maxRetries) { attempt++; await this.sleepImpl(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt); continue }
        throw new LlmError(`${this.name} HTTP ${res.status}`, 'http', true)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new LlmError(`${this.name} HTTP ${res.status}: ${text.slice(0, 300)}`, 'http', false)
      }
      const json = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      const usage = { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 }
      this.quota.record(usage.inputTokens + usage.outputTokens)
      const msg = json.choices?.[0]?.message
      if (msg?.refusal) throw new LlmError(`${this.name} refused: ${msg.refusal.slice(0, 200)}`, 'parse', false)
      const content = msg?.content ?? ''
      const parsed = extractJson(content)
      const data = validate(req.schema, parsed)
      const costUsd = this.free ? 0 : (usage.inputTokens * this.preset.pricing.input + usage.outputTokens * this.preset.pricing.output) / 1e6
      return { data, model: json.model ?? this.model, usage, costUsd, durationMs: Date.now() - started }
    }
  }

  /** Cheap liveness: list models (no tokens spent). */
  async status(): Promise<{ reachable: boolean; keyOk: boolean; models: string[] }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/models`, { headers: { authorization: `Bearer ${this.opts.apiKey}` }, signal: AbortSignal.timeout(4000) })
      if (res.status === 401 || res.status === 403) return { reachable: true, keyOk: false, models: [] }
      if (!res.ok) return { reachable: true, keyOk: true, models: [] }
      const j = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string }> }
      return { reachable: true, keyOk: true, models: (j.data ?? []).map((m) => m.id) }
    } catch {
      return { reachable: false, keyOk: false, models: [] }
    }
  }
}

/** Build a compat provider from env for a preset id, honouring LLM_<ID>_MODEL / _RPM / _RPD / _BASE_URL overrides. */
export function compatFromEnv(id: string, env: NodeJS.ProcessEnv, opts: Pick<OpenAICompatOptions, 'fetchImpl' | 'now' | 'sleepImpl'> = {}): OpenAICompatProvider {
  const preset = PRESETS[id]
  if (!preset) throw new LlmError(`Unknown provider "${id}"`, 'config')
  const U = id.toUpperCase()
  const num = (k: string) => (env[k] !== undefined && env[k] !== '' ? parseInt(env[k]!, 10) : undefined)
  return new OpenAICompatProvider({ preset, apiKey: env[preset.keyEnv] ?? '', model: env[`LLM_${U}_MODEL`], baseUrl: env[`LLM_${U}_BASE_URL`], rpm: num(`LLM_${U}_RPM`), rpd: num(`LLM_${U}_RPD`), tpm: num(`LLM_${U}_TPM`), free: env[`LLM_${U}_PAID`] === '1' ? false : undefined, ...opts })
}
