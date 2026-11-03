import type { JsonRequest, JsonResult, LlmProvider, LlmPurpose } from './types.js'
import { LlmError } from './types.js'
import { validate } from './json.js'

type Handler = (req: JsonRequest<unknown>) => unknown | Promise<unknown>

/** Test double: register a handler per purpose (or a default); records every request (minus nothing — tests only). */
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake'
  readonly calls: Array<{ purpose: LlmPurpose; user: string; system: string }> = []
  private handlers = new Map<LlmPurpose | '*', Handler>()

  on(purpose: LlmPurpose | '*', handler: Handler): this {
    this.handlers.set(purpose, handler)
    return this
  }

  async completeJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    this.calls.push({ purpose: req.purpose, user: req.user, system: req.system })
    const h = this.handlers.get(req.purpose) ?? this.handlers.get('*')
    if (!h) throw new LlmError(`FakeLlmProvider: no handler for purpose "${req.purpose}"`, 'config')
    const data = validate(req.schema, await h(req as JsonRequest<unknown>))
    return { data, model: 'fake', usage: { inputTokens: 10, outputTokens: 10 }, costUsd: 0, durationMs: 0 }
  }
}
