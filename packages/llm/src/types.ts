import type { ZodType, ZodTypeDef } from 'zod'

/** Why a call is being made — used for budgets, metering and logs (never log the prompt itself). */
export type LlmPurpose = 'extract_job' | 'parse_resume' | 'analyze_jd' | 'suggest' | 'headline' | 'answers' | 'test'

export interface JsonRequest<T> {
  purpose: LlmPurpose
  /** Stable instructions. Must not contain user data. */
  system: string
  /** The task + data. Untrusted text (job descriptions, resumes) must be wrapped with `untrusted()`. */
  user: string
  schema: ZodType<T, ZodTypeDef, unknown>
  /** Short name for the schema/tool, e.g. "resume". */
  schemaName?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  /** For per-user budgets. */
  userId?: string | null
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

export interface JsonResult<T> {
  data: T
  model: string
  usage: LlmUsage
  costUsd: number
  durationMs: number
}

export interface LlmProvider {
  readonly name: string
  completeJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>>
}

export class LlmError extends Error {
  constructor(message: string, readonly code: 'config' | 'budget' | 'http' | 'timeout' | 'schema' | 'parse', readonly retryable = false) {
    super(message)
    this.name = 'LlmError'
  }
}

/**
 * Wrap third-party text so the model treats it as data. The real defence against prompt injection is the
 * grounding validator (packages/resume) — this only reduces the attack surface.
 */
export function untrusted(label: string, text: string): string {
  const clean = text.replace(/<\/?untrusted[^>]*>/gi, '')
  return `<untrusted source="${label}">\n${clean}\n</untrusted>`
}
