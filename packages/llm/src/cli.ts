import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { JsonRequest, JsonResult, LlmProvider } from './types.js'
import { LlmError } from './types.js'
import { extractJson, validate } from './json.js'

const execFileAsync = promisify(execFile)

/**
 * Dev-only fallback: drives a local `claude` / `gemini` / `codex` CLI (the pre-v3 mechanism). Prompt goes
 * through stdin (not argv — argv is size-limited and visible in `ps`). Not for production: no budgets from
 * the vendor side, no structured output guarantees.
 */
export class CliProvider implements LlmProvider {
  readonly name = 'cli'
  private cli: string | null | undefined

  constructor(private readonly preferred?: string) {}

  private async detect(): Promise<string> {
    if (this.cli !== undefined) {
      if (this.cli === null) throw new LlmError('No LLM CLI found (claude/gemini/codex)', 'config')
      return this.cli
    }
    const candidates = this.preferred ? [this.preferred] : ['claude', 'gemini', 'codex']
    for (const c of candidates) {
      try {
        const { stdout } = await execFileAsync('which', [c])
        if (stdout.trim()) { this.cli = c; return c }
      } catch { /* not found */ }
    }
    this.cli = null
    throw new LlmError('No LLM CLI found (claude/gemini/codex)', 'config')
  }

  async completeJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    const cli = await this.detect()
    const schema = JSON.stringify(zodToJsonSchema(req.schema, { $refStrategy: 'none' }))
    const prompt = `${req.system}\n\nReturn ONLY a JSON object matching this JSON Schema, no markdown:\n${schema}\n\n${req.user}`
    const args = cli === 'claude' ? ['-p', '--output-format', 'text'] : cli === 'codex' ? ['-q', '-'] : []
    const started = Date.now()
    const child = execFileAsync(cli, args, { timeout: req.timeoutMs ?? 120_000, maxBuffer: 8 * 1024 * 1024 })
    child.child.stdin?.end(prompt)
    const { stdout } = await child
    const data = validate(req.schema, extractJson(stdout))
    return { data, model: cli, usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, durationMs: Date.now() - started }
  }
}
