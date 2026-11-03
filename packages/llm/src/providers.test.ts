import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { OpenAICompatProvider, QuotaLimiter, compatFromEnv } from './openai-compat.js'
import { PRESETS } from './presets.js'
import { ChainProvider } from './chain.js'
import { OpenAICompatEmbeddingProvider, createEmbeddingProvider } from './embeddings.js'
import { createLlmProvider, describeLlm } from './index.js'
import { FakeLlmProvider } from './fake.js'
import { LlmError, type JsonRequest, type LlmProvider } from './types.js'

const schema = z.object({ title: z.string(), skills: z.array(z.string()) })
const req = (purpose: JsonRequest<unknown>['purpose'] = 'analyze_jd', user = 'u'): JsonRequest<z.infer<typeof schema>> => ({ purpose, system: 'sys', user, schema, schemaName: 'job' })
const ok = (content: unknown, usage = { prompt_tokens: 100, completion_tokens: 20 }) => ({ status: 200, body: { model: 'm-1', choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage } })

function fakeFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = []
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null, headers: Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {})) })
    const r = responses.shift() ?? { status: 500, body: {} }
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } })
  }) as unknown as typeof fetch
  return { impl, calls }
}
const noSleep = async () => undefined

describe('QuotaLimiter (client-side free-tier guard)', () => {
  it('enforces per-minute and per-day windows and rolls them over', () => {
    let t = Date.parse('2026-01-01T10:00:00Z')
    const q = new QuotaLimiter(2, 3, () => t)
    expect(q.check()).toBe(0); q.record(10)
    expect(q.check()).toBe(0); q.record(10)
    expect(q.check()).toBeGreaterThan(0) // minute full
    t += 60_000
    expect(q.check()).toBe(0); q.record(10)
    expect(q.check()).toBe(-1) // day exhausted (3 calls)
    expect(q.snapshot()).toMatchObject({ usedToday: 3, tokensToday: 30, rpd: 3, rpm: 2 })
    t += 86_400_000
    expect(q.check()).toBe(0)
    expect(q.snapshot().usedToday).toBe(0)
  })
})

describe('OpenAICompatProvider', () => {
  it('gemini preset: json_schema response_format, bearer key, cost 0 on the free tier, quota recorded', async () => {
    const { impl, calls } = fakeFetch([ok({ title: 'Backend Engineer', skills: ['Go'] })])
    const p = compatFromEnv('gemini', { GEMINI_API_KEY: 'k' }, { fetchImpl: impl, sleepImpl: noSleep })
    const r = await p.completeJson(req())
    expect(r.data).toEqual({ title: 'Backend Engineer', skills: ['Go'] })
    expect(r.costUsd).toBe(0)
    expect(r.model).toBe('m-1')
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect(calls[0].headers.authorization).toBe('Bearer k')
    expect(calls[0].body.model).toBe('gemini-2.0-flash')
    expect(calls[0].body.response_format.type).toBe('json_schema')
    expect(calls[0].body.response_format.json_schema.schema.properties.skills.type).toBe('array')
    expect(calls[0].body.messages[0].content).toBe('sys') // schema not duplicated into the prompt
    expect(p.quota.snapshot()).toMatchObject({ usedToday: 1, tokensToday: 120 })
    expect(p.dataUse).toBe('may-train')
  })

  it('groq preset: json_object mode puts the schema in the system prompt, fenced output is parsed, TPM cap trims long prompts', async () => {
    const { impl, calls } = fakeFetch([ok('```json\n{"title":"SRE","skills":[]}\n```')])
    const p = compatFromEnv('groq', { GROQ_API_KEY: 'k', LLM_GROQ_MODEL: 'llama-3.1-8b-instant' }, { fetchImpl: impl, sleepImpl: noSleep })
    const r = await p.completeJson({ ...req('analyze_jd', 'x'.repeat(200_000)), maxTokens: 1000 })
    expect(r.data.title).toBe('SRE')
    expect(calls[0].body.model).toBe('llama-3.1-8b-instant')
    expect(calls[0].body.response_format).toEqual({ type: 'json_object' })
    expect(calls[0].body.messages[0].content).toContain('"properties"')
    const sent = calls[0].body.messages[1].content as string
    expect(sent.length).toBeLessThan(60_000) // 12k TPM → ≈ 41k chars
    expect(sent).toContain('characters omitted')
  })

  it('429 beyond retries becomes a non-retryable budget error (chain moves on); 401 disables the provider', async () => {
    const { impl } = fakeFetch([{ status: 429, body: {}, headers: { 'retry-after': '120' } }])
    const p = compatFromEnv('cerebras', { CEREBRAS_API_KEY: 'k' }, { fetchImpl: impl, sleepImpl: noSleep })
    await expect(p.completeJson(req())).rejects.toMatchObject({ code: 'budget' })
    const { impl: impl2 } = fakeFetch([{ status: 401, body: { error: 'bad key' } }])
    const p2 = compatFromEnv('groq', { GROQ_API_KEY: 'bad' }, { fetchImpl: impl2, sleepImpl: noSleep })
    await expect(p2.completeJson(req())).rejects.toMatchObject({ code: 'config' })
    expect(p2.disabledReason).toMatch(/GROQ_API_KEY/)
    await expect(p2.completeJson(req())).rejects.toMatchObject({ code: 'config' }) // no second round-trip
  })

  it('client-side quota stops calls before the provider does', async () => {
    const { impl, calls } = fakeFetch([ok({ title: 'a', skills: [] }), ok({ title: 'b', skills: [] })])
    const p = compatFromEnv('openrouter', { OPENROUTER_API_KEY: 'k', LLM_OPENROUTER_RPD: '1' }, { fetchImpl: impl, sleepImpl: noSleep })
    await p.completeJson(req())
    await expect(p.completeJson(req())).rejects.toMatchObject({ code: 'budget' })
    expect(calls.length).toBe(1)
  })

  it('schema-invalid output is a typed schema error; missing key is a config error at construction', async () => {
    const { impl } = fakeFetch([ok({ title: 5 })])
    const p = compatFromEnv('gemini', { GEMINI_API_KEY: 'k' }, { fetchImpl: impl, sleepImpl: noSleep })
    await expect(p.completeJson(req())).rejects.toMatchObject({ code: 'schema' })
    expect(() => compatFromEnv('gemini', {})).toThrow(/GEMINI_API_KEY/)
    expect(() => compatFromEnv('nope', {})).toThrow(/Unknown provider/)
  })

  it('status(): /models reachability and key validity without spending tokens', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { data: [{ id: 'gemini-2.0-flash' }] } }])
    const p = compatFromEnv('gemini', { GEMINI_API_KEY: 'k' }, { fetchImpl: impl })
    expect(await p.status()).toEqual({ reachable: true, keyOk: true, models: ['gemini-2.0-flash'] })
    expect(calls[0].url).toMatch(/\/models$/)
    const { impl: bad } = fakeFetch([{ status: 403, body: {} }])
    expect((await compatFromEnv('gemini', { GEMINI_API_KEY: 'k' }, { fetchImpl: bad }).status()).keyOk).toBe(false)
  })
})

describe('ChainProvider (ordered fallback + data-use policy)', () => {
  const member = (name: string, dataUse: 'local' | 'no-train' | 'may-train', impl: LlmProvider['completeJson'], piiAllowed = false) => ({ provider: { name, completeJson: impl } as LlmProvider, dataUse, piiAllowed })
  const answer = (tag: string) => async <T>(r: JsonRequest<T>) => ({ data: r.schema.parse({ title: tag, skills: [] }), model: tag, usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0, durationMs: 1 })

  it('public purposes go to the first provider; resume-derived purposes skip may-train providers', async () => {
    const calls: string[] = []
    const chain = new ChainProvider([
      member('gemini', 'may-train', async (r) => { calls.push(`gemini:${r.purpose}`); return answer('gemini')(r) }),
      member('ollama', 'local', async (r) => { calls.push(`ollama:${r.purpose}`); return answer('ollama')(r) }),
    ])
    expect((await chain.completeJson(req('analyze_jd'))).model).toBe('gemini')
    expect((await chain.completeJson(req('suggest'))).model).toBe('ollama')
    expect((await chain.completeJson(req('parse_resume'))).model).toBe('ollama')
    expect(calls).toEqual(['gemini:analyze_jd', 'ollama:suggest', 'ollama:parse_resume'])
    expect(chain.eligible('suggest')[0].skip).toMatch(/data-use policy/)
    expect(chain.name).toBe('gemini>ollama')
  })

  it('operator opt-in (piiAllowed) lets a may-train provider see resume text', async () => {
    const chain = new ChainProvider([member('gemini', 'may-train', answer('gemini'), true), member('ollama', 'local', answer('ollama'))])
    expect((await chain.completeJson(req('suggest'))).model).toBe('gemini')
  })

  it('budget/http/timeout errors fall through; http/timeout put the member in cooldown; schema errors do not fall through', async () => {
    let t = 0
    let groqCalls = 0
    const chain = new ChainProvider([
      member('groq', 'no-train', async () => { groqCalls++; throw new LlmError('groq HTTP 503', 'http', true) }),
      member('ollama', 'local', answer('ollama')),
    ], { cooldownMs: 60_000, now: () => t })
    expect((await chain.completeJson(req())).model).toBe('ollama')
    expect((await chain.completeJson(req())).model).toBe('ollama')
    expect(groqCalls).toBe(1) // second call skipped groq during cooldown
    expect(chain.describe()[0].coolingDown).toMatch(/503/)
    t += 61_000
    await chain.completeJson(req())
    expect(groqCalls).toBe(2)

    const strict = new ChainProvider([member('a', 'local', async () => { throw new LlmError('bad output', 'schema') }), member('b', 'local', answer('b'))])
    await expect(strict.completeJson(req())).rejects.toMatchObject({ code: 'schema' })

    const quota = new ChainProvider([member('a', 'local', async () => { throw new LlmError('quota', 'budget') }), member('b', 'local', answer('b'))])
    expect((await quota.completeJson(req())).model).toBe('b')
  })

  it('when every member is skipped or failing, the error lists each reason', async () => {
    const chain = new ChainProvider([member('gemini', 'may-train', answer('gemini')), member('groq', 'no-train', async () => { throw new LlmError('daily quota exhausted', 'budget') })])
    await expect(chain.completeJson(req('answers'))).rejects.toThrow(/gemini: data-use policy.*groq: daily quota exhausted/)
  })
})

describe('createLlmProvider / describeLlm (env wiring)', () => {
  it('parses a comma-separated chain, applies LLM_PII_PROVIDERS, and enforces the policy even on a lone may-train provider', async () => {
    const chain = createLlmProvider({ env: { LLM_PROVIDER: 'gemini,fake', GEMINI_API_KEY: 'k' }, budget: false }) as ChainProvider
    expect(chain).toBeInstanceOf(ChainProvider)
    expect(chain.describe().map((d) => [d.name, d.piiAllowed])).toEqual([['gemini', false], ['fake', true]])

    const allowed = createLlmProvider({ env: { LLM_PROVIDER: 'gemini,fake', GEMINI_API_KEY: 'k', LLM_PII_PROVIDERS: 'gemini' }, budget: false }) as ChainProvider
    expect(allowed.describe()[0].piiAllowed).toBe(true)

    const lone = createLlmProvider({ env: { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' }, budget: false })
    expect(lone).toBeInstanceOf(ChainProvider) // policy wrapper
    await expect(lone!.completeJson(req('parse_resume'))).rejects.toThrow(/data-use policy/)

    expect(createLlmProvider({ env: { LLM_PROVIDER: 'none' } })).toBeNull()
    expect(createLlmProvider({ env: { LLM_PROVIDER: 'fake,none' }, budget: false })).toBeInstanceOf(FakeLlmProvider)
    expect(() => createLlmProvider({ env: { LLM_PROVIDER: 'gemini' } })).toThrow(/GEMINI_API_KEY/) // lone provider: loud
    // shipped default with empty keys: members without keys are skipped, the chain still boots on what is left
    expect(createLlmProvider({ env: { LLM_PROVIDER: 'cerebras,gemini,fake,none' }, budget: false })).toBeInstanceOf(FakeLlmProvider)
    expect(createLlmProvider({ env: { LLM_PROVIDER: 'cerebras,gemini,groq,none' } })).toBeNull()
    const partial = createLlmProvider({ env: { LLM_PROVIDER: 'cerebras,gemini,groq,none', GEMINI_API_KEY: 'k' }, budget: false }) as ChainProvider
    expect(partial.describe().map((d) => d.name)).toEqual(['gemini'])
    expect(createEmbeddingProvider({ EMBEDDING_PROVIDER: 'gemini' })).toBeNull()
    expect(() => createLlmProvider({ env: { LLM_PROVIDER: 'bogus' } })).toThrow(/Unknown LLM_PROVIDER "bogus"/)
  })

  it('describeLlm reports each member with kind, data-use, PII eligibility and quota', async () => {
    const st = await describeLlm({ LLM_PROVIDER: 'gemini,fake', GEMINI_API_KEY: 'k', LLM_GEMINI_BASE_URL: 'http://127.0.0.1:1' })
    expect(st.configured).toEqual(['gemini', 'fake'])
    expect(st.providers[0]).toMatchObject({ name: 'gemini', kind: 'cloud', model: 'gemini-2.0-flash', dataUse: 'may-train', piiAllowed: false })
    expect(typeof st.providers[0].reachable).toBe('boolean') // real network → false here; a fetch double in the same process may answer
    expect(st.providers[0].quota).toMatchObject({ rpm: 15, rpd: 1500 })
    expect(st.providers[1]).toMatchObject({ name: 'fake', kind: 'local', dataUse: 'local', piiAllowed: true })
    const missing = await describeLlm({ LLM_PROVIDER: 'groq' })
    expect(missing.providers[0].detail).toMatch(/GROQ_API_KEY/)
  })
})

describe('OpenAICompatEmbeddingProvider', () => {
  it('embeds in order, normalises, and is selected by EMBEDDING_PROVIDER=<preset>', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { data: [{ index: 1, embedding: [0, 2, 0] }, { index: 0, embedding: [3, 0, 0] }] } }])
    const p = new OpenAICompatEmbeddingProvider({ preset: PRESETS.gemini, apiKey: 'k', fetchImpl: impl, dims: 3 })
    const v = await p.embed(['a', 'b'])
    expect(Array.from(v[0])).toEqual([1, 0, 0])
    expect(Array.from(v[1])).toEqual([0, 1, 0])
    expect(calls[0].url).toMatch(/\/embeddings$/)
    expect(calls[0].body.model).toBe('text-embedding-004')
    const fromEnv = createEmbeddingProvider({ EMBEDDING_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', EMBEDDING_MODEL: 'nomic-embed-text', EMBEDDING_DIMS: '768' })
    expect(fromEnv).toBeInstanceOf(OpenAICompatEmbeddingProvider)
    expect(fromEnv!.model).toBe('text-embedding-004') // the Ollama default is not carried over
    expect(() => createEmbeddingProvider({ EMBEDDING_PROVIDER: 'groq', GROQ_API_KEY: 'k' })).toThrow(/no embedding model/)
  })
})
