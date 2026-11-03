import type { ZodType, ZodTypeDef } from 'zod'
import { LlmError } from './types.js'

/** Pull the first JSON object/array out of free text (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.search(/[{[]/)
  if (start < 0) throw new LlmError('No JSON found in model output', 'parse')
  // Walk to the matching close bracket so trailing prose doesn't break JSON.parse.
  const open = candidate[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1))
        } catch (err) {
          throw new LlmError(`Invalid JSON in model output: ${(err as Error).message}`, 'parse')
        }
      }
    }
  }
  throw new LlmError('Unterminated JSON in model output', 'parse')
}

export function validate<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) {
    const issues = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; ')
    throw new LlmError(`Model output failed schema validation: ${issues}`, 'schema')
  }
  return r.data
}
