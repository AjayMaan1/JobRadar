import { log } from '@jobradar/log'
import type { JsonRequest, JsonResult, LlmProvider } from './types.js'
import { LlmError } from './types.js'
import { PII_PURPOSES, type DataUse } from './presets.js'

export interface ChainMember {
  provider: LlmProvider
  /** local (Ollama/cli/fake) | no-train | may-train — decides which purposes the member may see. */
  dataUse: DataUse
  /** Operator override: this member may receive resume-derived purposes regardless of dataUse. */
  piiAllowed: boolean
}

export interface ChainOptions {
  /** After a retryable failure, skip the member for this long (ms) so every call does not pay the timeout. */
  cooldownMs?: number
  now?: () => number
}

/**
 * Ordered fallback across providers (docs/AI-PROVIDERS.md §4): the first member that (a) is allowed to see
 * the purpose under the data-use policy, (b) is not cooling down after a failure and (c) has quota left
 * handles the call. Non-retryable model/schema errors from a member end the call (another model would not
 * "fix" a malformed request); config/budget/http/timeout errors move to the next member.
 */
export class ChainProvider implements LlmProvider {
  readonly name: string
  private cooldown = new Map<string, { until: number; reason: string }>()
  private readonly cooldownMs: number
  private readonly now: () => number
  constructor(readonly members: ChainMember[], opts: ChainOptions = {}) {
    if (!members.length) throw new LlmError('LLM chain has no providers', 'config')
    this.name = members.map((m) => m.provider.name).join('>')
    this.cooldownMs = opts.cooldownMs ?? 60_000
    this.now = opts.now ?? Date.now
  }

  /** Members eligible for a purpose, in order, with the reason for each skip (for /api/health and logs). */
  eligible(purpose: string): Array<{ member: ChainMember; skip: string | null }> {
    const pii = PII_PURPOSES.has(purpose)
    return this.members.map((member) => {
      if (pii && member.dataUse === 'may-train' && !member.piiAllowed) return { member, skip: 'data-use policy: resume text is not sent to providers that may train on it' }
      const cd = this.cooldown.get(member.provider.name)
      if (cd && cd.until > this.now()) return { member, skip: `cooling down after: ${cd.reason}` }
      return { member, skip: null }
    })
  }

  async completeJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    const errors: string[] = []
    for (const { member, skip } of this.eligible(req.purpose)) {
      if (skip) { errors.push(`${member.provider.name}: ${skip}`); continue }
      try {
        return await member.provider.completeJson(req)
      } catch (err) {
        const e = err as LlmError
        const code = e instanceof LlmError ? e.code : 'http'
        errors.push(`${member.provider.name}: ${e.message}`)
        // model produced bad output for a well-formed request → a different model will not help; surface it
        if (code === 'schema' || code === 'parse') throw err
        if (code === 'http' || code === 'timeout') this.cooldown.set(member.provider.name, { until: this.now() + this.cooldownMs, reason: e.message.slice(0, 120) })
        if (this.members.indexOf(member) < this.members.length - 1) log.warn('llm chain: falling through', { from: member.provider.name, purpose: req.purpose, code, reason: e.message.slice(0, 160) })
      }
    }
    throw new LlmError(`No LLM provider could serve "${req.purpose}": ${errors.join(' | ')}`, 'budget')
  }

  /** Summary for /api/health. */
  describe(): Array<{ name: string; dataUse: DataUse; piiAllowed: boolean; coolingDown: string | null }> {
    return this.members.map((m) => ({ name: m.provider.name, dataUse: m.dataUse, piiAllowed: m.piiAllowed || m.dataUse !== 'may-train', coolingDown: (() => { const cd = this.cooldown.get(m.provider.name); return cd && cd.until > this.now() ? cd.reason : null })() }))
  }
}
