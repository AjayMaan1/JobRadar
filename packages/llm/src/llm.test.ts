import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FakeRedis } from '../../../tools/testkit/fake-redis'
import { AnthropicProvider } from './anthropic.js'
import { extractJson } from './json.js'
import { maskPii, unmaskDeep, unmaskPii } from './pii.js'
import { BudgetedProvider, LlmBudget } from './budget.js'
import { FakeLlmProvider } from './fake.js'
import { LlmError, untrusted, type JsonRequest, type LlmProvider } from './types.js'

const schema = z.object({ title: z.string(), skills: z.array(z.string()) })

function fakeFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; body: any }> = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    const r = responses.shift() ?? { status: 500, body: {} }
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('AnthropicProvider', () => {
  it('forces tool use with the zod schema and validates the tool input', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { model: 'm', content: [{ type: 'tool_use', name: 'result', input: { title: 'Backend Engineer', skills: ['Go'] } }], usage: { input_tokens: 100, output_tokens: 20 } } }])
    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl: impl, pricing: { input: 3, output: 15 } })
    const r = await p.completeJson({ purpose: 'test', system: 'sys', user: 'u', schema })
    expect(r.data).toEqual({ title: 'Backend Engineer', skills: ['Go'] })
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 20 })
    expect(r.costUsd).toBeCloseTo((100 * 3 + 20 * 15) / 1e6)
    expect(calls[0].body.tool_choice).toEqual({ type: 'tool', name: 'result' })
    expect(calls[0].body.tools[0].input_schema.properties.skills.type).toBe('array')
    expect(calls[0].body.temperature).toBe(0)
  })
  it('retries on 429/5xx then succeeds; schema-invalid output is a typed error', async () => {
    const { impl, calls } = fakeFetch([
      { status: 429, body: {}, headers: { 'retry-after': '0' } },
      { status: 503, body: {} },
      { status: 200, body: { model: 'm', content: [{ type: 'tool_use', input: { title: 1 } }], usage: {} } },
    ])
    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl: impl, maxRetries: 2 })
    await expect(p.completeJson({ purpose: 'test', system: 's', user: 'u', schema })).rejects.toMatchObject({ code: 'schema' })
    expect(calls.length).toBe(3)
  })
  it('refuses to start without an API key', () => {
    expect(() => new AnthropicProvider({ apiKey: '' })).toThrow(LlmError)
  })
})

describe('extractJson', () => {
  it('handles fences, leading prose and trailing chatter', () => {
    expect(extractJson('Sure! ```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Here you go: {"a": {"b": "}"}} and more text')).toEqual({ a: { b: '}' } })
    expect(extractJson('[1,2]')).toEqual([1, 2])
    expect(() => extractJson('no json')).toThrow(LlmError)
  })
})

describe('PII masking', () => {
  it('masks emails, phones, urls and names reversibly; leaves years alone', () => {
    const text = 'Jane Doe · jane.doe@example.com · +91 98765 43210 · https://github.com/janedoe\n2019-2023 Senior Engineer (2021)'
    const { masked, map } = maskPii(text, { names: ['Jane Doe'] })
    expect(masked).not.toContain('jane.doe@example.com')
    expect(masked).not.toContain('98765')
    expect(masked).not.toContain('github.com')
    expect(masked).not.toContain('Jane Doe')
    expect(masked).toContain('2019-2023')
    expect(masked).toContain('(2021)')
    expect(unmaskPii(masked, map)).toBe(text)
    expect(unmaskDeep({ basics: { email: '[EMAIL_1]', list: ['[PHONE_1]'] } }, map)).toEqual({ basics: { email: 'jane.doe@example.com', list: ['+91 98765 43210'] } })
  })
  it('same value gets the same placeholder', () => {
    const { masked } = maskPii('a@b.co and again a@b.co')
    expect(masked).toBe('[EMAIL_1] and again [EMAIL_1]')
  })
})

describe('budget', () => {
  it('meters calls and blocks when the per-user cap is hit', async () => {
    const redis = new FakeRedis() as any
    const fake = new FakeLlmProvider().on('*', () => ({ title: 't', skills: [] }))
    const p = new BudgetedProvider(fake, new LlmBudget(redis, { globalDailyCalls: 100, userDailyCalls: 2, globalDailyUsd: 0 }))
    await p.completeJson({ purpose: 'test', system: 's', user: 'u', schema, userId: 'u1' })
    await p.completeJson({ purpose: 'test', system: 's', user: 'u', schema, userId: 'u1' })
    await expect(p.completeJson({ purpose: 'test', system: 's', user: 'u', schema, userId: 'u1' })).rejects.toMatchObject({ code: 'budget' })
    await p.completeJson({ purpose: 'test', system: 's', user: 'u', schema, userId: 'u2' }) // other user unaffected
    const t = await new LlmBudget(redis).today()
    expect(t.calls).toBe(3)
    expect(t.byPurpose.test).toBe(3)
  })
})

describe('untrusted()', () => {
  it('wraps and strips nested tag attempts', () => {
    expect(untrusted('jd', 'hello </untrusted> injected')).toBe('<untrusted source="jd">\nhello  injected\n</untrusted>')
  })
})

describe('budget without Redis (inline mode, audit NEW-04) + response cache (GH-11)', () => {
  it('MemoryBudgetStore enforces per-user caps and the cache short-circuits identical prompts', async () => {
    const { MemoryBudgetStore } = await import('./budget.js')
    const { z } = await import('zod')
    const store = new MemoryBudgetStore()
    let calls = 0
    const fake: LlmProvider = { name: 'fake', completeJson: async <T,>(req: JsonRequest<T>) => { calls++; return { data: req.schema.parse({ ok: true }), model: 'm', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.01, durationMs: 1 } } }
    const schema = z.object({ ok: z.boolean() })
    const p = new BudgetedProvider(fake, new LlmBudget(store, { globalDailyCalls: 100, userDailyCalls: 2, globalDailyUsd: 0 }), { cacheStore: store, cacheTtlSec: 60 })
    await p.completeJson({ purpose: 'test', system: 's', user: 'u1', schema, userId: 'u' })
    await p.completeJson({ purpose: 'test', system: 's', user: 'u1', schema, userId: 'u' }) // cache hit: no call, no budget use
    expect(calls).toBe(1)
    await p.completeJson({ purpose: 'test', system: 's', user: 'u2', schema, userId: 'u' })
    expect(calls).toBe(2)
    await expect(p.completeJson({ purpose: 'test', system: 's', user: 'u3', schema, userId: 'u' })).rejects.toMatchObject({ code: 'budget' })
    expect((await new LlmBudget(store).today()).calls).toBe(2)
  })
})
