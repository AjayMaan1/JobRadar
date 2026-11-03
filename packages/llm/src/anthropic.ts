import { zodToJsonSchema } from 'zod-to-json-schema'
import type { JsonRequest, JsonResult, LlmProvider } from './types.js'
import { LlmError } from './types.js'
import { validate } from './json.js'

export interface AnthropicOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  /** USD per 1M tokens, for metering only. */
  pricing?: { input: number; output: number }
  maxRetries?: number
  fetchImpl?: typeof fetch
}

const DEFAULT_MODEL = 'claude-sonnet-4-5'

/**
 * Anthropic Messages API with forced tool use: the tool's input_schema is the zod schema, so the model
 * must return a JSON object matching it (validated again locally). No SDK dependency — plain fetch.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic'
  private readonly model: string
  private readonly baseUrl: string
  private readonly pricing: { input: number; output: number }
  private readonly maxRetries: number
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opts: AnthropicOptions) {
    if (!opts.apiKey) throw new LlmError('ANTHROPIC_API_KEY is not set', 'config')
    this.model = opts.model ?? DEFAULT_MODEL
    this.baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')
    this.pricing = opts.pricing ?? { input: 3, output: 15 }
    this.maxRetries = opts.maxRetries ?? 2
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async completeJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    const toolName = (req.schemaName ?? 'result').replace(/[^a-zA-Z0-9_-]/g, '_')
    const inputSchema = zodToJsonSchema(req.schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>
    delete inputSchema.$schema
    const body = {
      model: this.model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      tools: [{ name: toolName, description: 'Return the structured result.', input_schema: inputSchema }],
      tool_choice: { type: 'tool', name: toolName },
    }

    const started = Date.now()
    let attempt = 0
    for (;;) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 60_000)
      let res: Response
      try {
        res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.opts.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        })
      } catch (err) {
        clearTimeout(timer)
        const aborted = (err as Error).name === 'AbortError'
        if (attempt < this.maxRetries) { attempt++; await sleep(backoff(attempt)); continue }
        throw new LlmError(aborted ? 'LLM request timed out' : `LLM request failed: ${(err as Error).message}`, aborted ? 'timeout' : 'http', true)
      }
      clearTimeout(timer)

      if (res.status === 429 || res.status >= 500) {
        if (attempt < this.maxRetries) {
          attempt++
          const ra = parseFloat(res.headers.get('retry-after') ?? '')
          await sleep(Number.isFinite(ra) ? ra * 1000 : backoff(attempt))
          continue
        }
        throw new LlmError(`LLM HTTP ${res.status}`, 'http', true)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new LlmError(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`, 'http', false)
      }

      const json = (await res.json()) as {
        model: string
        content: Array<{ type: string; name?: string; input?: unknown; text?: string }>
        usage?: { input_tokens?: number; output_tokens?: number }
        stop_reason?: string
      }
      const tool = json.content.find((c) => c.type === 'tool_use')
      if (!tool) throw new LlmError(`Model did not call the tool (stop_reason=${json.stop_reason})`, 'parse')
      const data = validate(req.schema, tool.input)
      const usage = { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 }
      const costUsd = (usage.inputTokens * this.pricing.input + usage.outputTokens * this.pricing.output) / 1_000_000
      return { data, model: json.model ?? this.model, usage, costUsd, durationMs: Date.now() - started }
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250)
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
