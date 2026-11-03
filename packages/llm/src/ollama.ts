import { zodToJsonSchema } from 'zod-to-json-schema'
import type { JsonRequest, JsonResult, LlmProvider } from './types.js'
import { LlmError } from './types.js'
import { validate } from './json.js'

export interface OllamaOptions {
  baseUrl?: string          // default http://127.0.0.1:11434
  model?: string            // default qwen2.5:3b-instruct
  /** Context window. Small CPU boxes: 8192. */
  numCtx?: number
  /** Hard cap on user-prompt characters; longer prompts are truncated with a marker (prompt processing is slow on CPU). */
  maxPromptChars?: number
  numThread?: number
  keepAlive?: string        // e.g. "30m"
  fetchImpl?: typeof fetch
}

/**
 * Local LLM via Ollama's /api/chat with JSON-schema constrained output (`format`). Free, offline, and the
 * default on the self-hosted box. CPU-bound: one request at a time (worker `llm` lane, concurrency 1),
 * long timeouts, capped prompts. Quality: good enough for extraction/rewrites because every output is
 * schema-validated and the grounding validator guards against invented facts.
 */
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama'
  private readonly baseUrl: string
  private readonly model: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opts: OllamaOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
    this.model = opts.model ?? 'qwen2.5:3b-instruct'
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private capPrompt(user: string): string {
    const max = this.opts.maxPromptChars ?? 16_000
    if (user.length <= max) return user
    // keep the head (instructions + data start) and the tail (closing tags), drop the middle
    const head = user.slice(0, Math.floor(max * 0.8))
    const tail = user.slice(-Math.floor(max * 0.15))
    return `${head}\n[… ${user.length - max} characters omitted to fit the local model's context …]\n${tail}`
  }

  async completeJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    const schema = zodToJsonSchema(req.schema, { $refStrategy: 'none' }) as Record<string, unknown>
    delete schema.$schema
    const started = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 15 * 60_000)
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: schema,
          keep_alive: this.opts.keepAlive ?? '30m',
          options: {
            temperature: req.temperature ?? 0,
            num_ctx: this.opts.numCtx ?? 8192,
            num_predict: req.maxTokens ?? 2048,
            ...(this.opts.numThread ? { num_thread: this.opts.numThread } : {}),
          },
          messages: [
            { role: 'system', content: `${req.system}\n\nRespond with a single JSON object that matches the required schema. No prose.` },
            { role: 'user', content: this.capPrompt(req.user) },
          ],
        }),
        signal: ctrl.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      const aborted = (err as Error).name === 'AbortError'
      throw new LlmError(aborted ? `Ollama timed out after ${Math.round((req.timeoutMs ?? 900_000) / 60_000)} min` : `Ollama unreachable at ${this.baseUrl} (${(err as Error).message}). Is it running? \`ollama serve\``, aborted ? 'timeout' : 'http', true)
    }
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 404 && /not found/i.test(text)) throw new LlmError(`Ollama model "${this.model}" is not pulled. Run: ollama pull ${this.model}`, 'config')
      throw new LlmError(`Ollama HTTP ${res.status}: ${text.slice(0, 300)}`, 'http', res.status >= 500)
    }
    const json = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number; model?: string }
    const content = json.message?.content ?? ''
    let parsed: unknown
    try { parsed = JSON.parse(content) } catch { throw new LlmError('Ollama returned non-JSON output', 'parse', true) }
    const data = validate(req.schema, parsed)
    return { data, model: json.model ?? this.model, usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0 }, costUsd: 0, durationMs: Date.now() - started }
  }

  /** Liveness + model availability, for the health page and startup log. */
  async status(): Promise<{ reachable: boolean; models: string[]; hasModel: boolean }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) })
      if (!res.ok) return { reachable: false, models: [], hasModel: false }
      const j = (await res.json()) as { models?: Array<{ name: string }> }
      const models = (j.models ?? []).map((m) => m.name)
      return { reachable: true, models, hasModel: models.some((m) => m === this.model || m.startsWith(`${this.model}:`) || this.model.startsWith(m.replace(/:latest$/, ''))) }
    } catch {
      return { reachable: false, models: [], hasModel: false }
    }
  }
}
