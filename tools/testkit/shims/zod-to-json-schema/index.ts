/** Sandbox shim: walks the mini-zod shim's structure and emits a JSON-Schema-ish object. */
import { ZodTuple, ZodArray, ZodBoolean, ZodDefault, ZodCatch, ZodEnum, ZodLiteral, ZodNullable, ZodNumber, ZodObject, ZodOptional, ZodRecord, ZodString, ZodUnion, type ZodTypeAny } from 'zod'

export function zodToJsonSchema(t: ZodTypeAny, _opts?: Record<string, unknown>): Record<string, unknown> {
  return walk(t)
}
function walk(t: ZodTypeAny): Record<string, unknown> {
  if (t instanceof ZodOptional || t instanceof ZodDefault || t instanceof ZodCatch) return walk(t.inner)
  if (t instanceof ZodNullable) return { anyOf: [walk(t.inner), { type: 'null' }] }
  if (t instanceof ZodString) return { type: 'string' }
  if (t instanceof ZodNumber) return { type: 'number' }
  if (t instanceof ZodBoolean) return { type: 'boolean' }
  if (t instanceof ZodLiteral) return { const: t.value }
  if (t instanceof ZodEnum) return { type: 'string', enum: [...t.options] }
  if (t instanceof ZodArray) return { type: 'array', items: walk(t.element) }
  if (t instanceof ZodTuple) return { type: 'array', items: t.items.map(walk), minItems: t.items.length, maxItems: t.items.length }
  if (t instanceof ZodRecord) return { type: 'object', additionalProperties: walk(t.value) }
  if (t instanceof ZodUnion) return { anyOf: t.options.map(walk) }
  if (t instanceof ZodObject) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [k, v] of Object.entries(t.shape)) {
      properties[k] = walk(v as ZodTypeAny)
      if (!(v instanceof ZodOptional || v instanceof ZodDefault || v instanceof ZodCatch)) required.push(k)
    }
    return { type: 'object', properties, required, additionalProperties: false }
  }
  return {}
}
