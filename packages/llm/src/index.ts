import type Redis from 'ioredis'
import { log } from '@jobradar/log'
import { AnthropicProvider } from './anthropic.js'
import { CliProvider } from './cli.js'
import { FakeLlmProvider } from './fake.js'
import { OllamaProvider } from './ollama.js'
import { BudgetedProvider, LlmBudget, MemoryBudgetStore, limitsFromEnv } from './budget.js'
import { ChainProvider, type ChainMember } from './chain.js'
import { OpenAICompatProvider, compatFromEnv } from './openai-compat.js'
import { PRESETS } from './presets.js'
import type { LlmProvider } from './types.js'
import { LlmError } from './types.js'

export type { LlmProvider, JsonRequest, JsonResult, LlmUsage, LlmPurpose } from './types.js'
export { LlmError, untrusted } from './types.js'
export { AnthropicProvider } from './anthropic.js'
export { CliProvider } from './cli.js'
export { FakeLlmProvider } from './fake.js'
export { OllamaProvider } from './ollama.js'
export type { OllamaOptions } from './ollama.js'
export { OllamaEmbeddingProvider, FakeEmbeddingProvider, OpenAICompatEmbeddingProvider, createEmbeddingProvider, cosine, normalize } from './embeddings.js'
export { OpenAICompatProvider, QuotaLimiter, compatFromEnv } from './openai-compat.js'
export type { OpenAICompatOptions } from './openai-compat.js'
export { PRESETS, PII_PURPOSES } from './presets.js'
export type { DataUse, ProviderPreset } from './presets.js'
export { ChainProvider } from './chain.js'
export type { ChainMember } from './chain.js'
export type { EmbeddingProvider } from './embeddings.js'
export { LlmBudget, BudgetedProvider, MemoryBudgetStore, limitsFromEnv } from './budget.js'
export type { BudgetLimits, BudgetStore, BudgetedOptions } from './budget.js'
export { maskPii, unmaskPii, unmaskDeep } from './pii.js'
export type { PiiMap, MaskResult } from './pii.js'
export { extractJson } from './json.js'

export interface CreateOptions {
  /** When given, calls are budgeted/metered in Redis; without it an in-process budget applies (audit NEW-04). */
  redis?: Redis
  env?: NodeJS.ProcessEnv
  /** Explicitly disable the budget wrapper (tests only). */
  budget?: boolean
}

/** Process-wide memory budget so every inline-mode provider shares one set of counters. */
const g = globalThis as unknown as { __jobradarMemBudget?: MemoryBudgetStore; __jobradarLlmChain?: ChainProvider | null }

/**
 * LLM_PROVIDER = ollama (default, local/free) | anthropic | cli | fake | none | any preset id in PRESETS
 * (gemini, groq, cerebras, mistral, openrouter, openai), or a comma-separated **chain** such as
 * `gemini,ollama` — tried in order; see docs/AI-PROVIDERS.md §4 for the data-use policy that decides which
 * member may see resume-derived prompts (`LLM_PII_PROVIDERS`, `LLM_ALLOW_TRAINING_PROVIDERS_FOR_PII`).
 * Returns null for "none" so callers can degrade to deterministic-only behaviour.
 */
export function createLlmProvider(opts: CreateOptions = {}): LlmProvider | null {
  const env = opts.env ?? process.env
  const ids = (env.LLM_PROVIDER ?? 'ollama').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
  if (!ids.length || (ids.length === 1 && ids[0] === 'none')) return null
  const members: ChainMember[] = []
  const piiAllow = new Set((env.LLM_PII_PROVIDERS ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean))
  const allowTrainingForPii = env.LLM_ALLOW_TRAINING_PROVIDERS_FOR_PII === '1'
  const skipped: string[] = []
  for (const id of ids) {
    if (id === 'none') continue // "gemini,none": explicit deterministic floor — nothing to add
    let built: ReturnType<typeof buildOne>
    try { built = buildOne(id, env) } catch (err) {
      // A member without its API key is skipped (so the shipped .env.example with empty keys still boots) — unless it
      // is the only provider named, where silently disabling AI would hide a misconfiguration.
      if (ids.length === 1 || !(err instanceof LlmError) || err.code !== 'config' || !/is not set/.test(err.message)) throw err
      skipped.push(`${id} (${err.message})`)
      continue
    }
    members.push({ provider: built.provider, dataUse: built.dataUse, piiAllowed: allowTrainingForPii || piiAllow.has(id) })
  }
  if (skipped.length) log.warn(`LLM chain: skipping ${skipped.join(', ')} — add the key(s) to .env or run ./jobradar ai setup`)
  if (!members.length) { if (skipped.length) log.warn('LLM chain: no usable provider — AI features off, deterministic paths only'); return null }
  // a lone provider still goes through the chain when the data-use policy must be enforced on it
  const needsPolicy = members.some((m) => m.dataUse === 'may-train' && !m.piiAllowed)
  const provider: LlmProvider = members.length === 1 && !needsPolicy ? members[0].provider : new ChainProvider(members)
  g.__jobradarLlmChain = provider instanceof ChainProvider ? provider : null
  if (opts.budget === false) return provider
  const store = opts.redis ?? (g.__jobradarMemBudget ??= new MemoryBudgetStore())
  return new BudgetedProvider(provider, new LlmBudget(store, limitsFromEnv(env)), { cacheStore: env.LLM_CACHE !== 'off' ? store : null })
}

function buildOne(id: string, env: NodeJS.ProcessEnv): { provider: LlmProvider; dataUse: 'local' | 'no-train' | 'may-train' } {
  switch (id) {
    case 'ollama':
      return {
        dataUse: 'local',
        provider: new OllamaProvider({
          baseUrl: env.OLLAMA_BASE_URL,
          model: env.LLM_MODEL ?? env.OLLAMA_MODEL,
          numCtx: env.OLLAMA_NUM_CTX ? parseInt(env.OLLAMA_NUM_CTX, 10) : undefined,
          maxPromptChars: env.LLM_MAX_PROMPT_CHARS ? parseInt(env.LLM_MAX_PROMPT_CHARS, 10) : undefined,
          numThread: env.OLLAMA_NUM_THREAD ? parseInt(env.OLLAMA_NUM_THREAD, 10) : undefined,
          keepAlive: env.OLLAMA_KEEP_ALIVE,
        }),
      }
    case 'anthropic':
      return { dataUse: 'no-train', provider: new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY ?? '', model: env.LLM_ANTHROPIC_MODEL ?? (env.LLM_PROVIDER === 'anthropic' ? env.LLM_MODEL : undefined) ?? 'claude-sonnet-4-5', baseUrl: env.ANTHROPIC_BASE_URL }) }
    case 'cli':
      return { dataUse: 'local', provider: new CliProvider(env.LLM_CLI) }
    case 'fake':
      return { dataUse: 'local', provider: new FakeLlmProvider() }
    default: {
      if (!PRESETS[id]) throw new LlmError(`Unknown LLM_PROVIDER "${id}" (known: ollama, anthropic, cli, fake, none, ${Object.keys(PRESETS).join(', ')})`, 'config')
      const p: OpenAICompatProvider = compatFromEnv(id, env)
      return { dataUse: p.dataUse, provider: p }
    }
  }
}

export interface LlmStatus {
  configured: string[]
  providers: Array<{ name: string; kind: 'local' | 'cloud'; model: string | null; dataUse: 'local' | 'no-train' | 'may-train'; piiAllowed: boolean; reachable: boolean | null; detail: string | null; quota: { rpm: number; rpd: number; usedToday: number; usedMinute: number } | null; coolingDown: string | null }>
}

/**
 * Health view of the configured LLM setup (docs/AI-PROVIDERS.md §5): per member — reachability (Ollama
 * `/api/tags`, compat `/models`), model, data-use class, PII eligibility, client-side quota used today.
 */
export async function describeLlm(env: NodeJS.ProcessEnv = process.env): Promise<LlmStatus> {
  const ids = (env.LLM_PROVIDER ?? 'ollama').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
  const piiAllow = new Set((env.LLM_PII_PROVIDERS ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean))
  const allowTraining = env.LLM_ALLOW_TRAINING_PROVIDERS_FOR_PII === '1'
  const chain = g.__jobradarLlmChain ?? null
  const out: LlmStatus = { configured: ids, providers: [] }
  for (const id of ids) {
    if (id === 'none') continue
    let built: { provider: LlmProvider; dataUse: 'local' | 'no-train' | 'may-train' }
    try { built = buildOne(id, env) } catch (err) { out.providers.push({ name: id, kind: PRESETS[id] ? 'cloud' : 'local', model: null, dataUse: PRESETS[id]?.dataUse ?? 'local', piiAllowed: false, reachable: null, detail: (err as Error).message, quota: null, coolingDown: null }); continue }
    const p = built.provider
    const live = chain?.members.find((m) => m.provider.name === p.name)?.provider ?? p
    const piiAllowed = allowTraining || piiAllow.has(id) || built.dataUse !== 'may-train'
    const coolingDown = chain?.describe().find((d) => d.name === p.name)?.coolingDown ?? null
    if (p instanceof OllamaProvider) {
      const st = await p.status()
      out.providers.push({ name: id, kind: 'local', model: env.LLM_MODEL ?? 'qwen2.5:3b-instruct', dataUse: 'local', piiAllowed: true, reachable: st.reachable, detail: st.reachable ? (st.hasModel ? `${st.models.length} model(s)` : 'model not pulled') : 'not reachable', quota: null, coolingDown })
    } else if (live instanceof OpenAICompatProvider) {
      const st = await live.status()
      const q = live.quota.snapshot()
      out.providers.push({ name: id, kind: 'cloud', model: live.model, dataUse: live.dataUse, piiAllowed, reachable: st.reachable && st.keyOk, detail: live.disabledReason ?? (!st.reachable ? 'not reachable' : !st.keyOk ? 'API key rejected' : q.rpd && q.usedToday >= q.rpd ? 'daily quota exhausted' : null), quota: { rpm: q.rpm, rpd: q.rpd, usedToday: q.usedToday, usedMinute: q.usedMinute }, coolingDown })
    } else {
      out.providers.push({ name: id, kind: id === 'anthropic' ? 'cloud' : 'local', model: id === 'anthropic' ? (env.LLM_ANTHROPIC_MODEL ?? env.LLM_MODEL ?? 'claude-sonnet-4-5') : null, dataUse: built.dataUse, piiAllowed, reachable: null, detail: null, quota: null, coolingDown })
    }
  }
  return out
}
