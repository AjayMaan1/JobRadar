import { LlmError } from './types.js'
import { log } from '@jobradar/log'
import { PRESETS, type ProviderPreset } from './presets.js'

export interface EmbeddingProvider {
  readonly name: string
  readonly model: string
  readonly dims: number
  /** Batch embed; returns one Float32Array per input, L2-normalised so dot product == cosine. */
  embed(texts: string[]): Promise<Float32Array[]>
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n
  return out
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

/**
 * Ollama /api/embed (nomic-embed-text: 768 dims, 8k context). ~100 texts/s on a 2-core laptop CPU; the worker
 * batches ≤ 32 texts per call. Search-query embedding from the web tier uses a 3 s timeout and falls back to
 * exact search when Ollama is down.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama'
  readonly model: string
  readonly dims: number
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(opts: { baseUrl?: string; model?: string; dims?: number; fetchImpl?: typeof fetch } = {}) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
    this.model = opts.model ?? 'nomic-embed-text'
    this.dims = opts.dims ?? 768
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async embed(texts: string[], timeoutMs = 120_000): Promise<Float32Array[]> {
    if (!texts.length) return []
    const out: Float32Array[] = []
    for (let i = 0; i < texts.length; i += 32) {
      const batch = texts.slice(i, i + 32).map((t) => t.slice(0, 24_000))
      let res: Response
      try {
        res = await this.fetchImpl(`${this.baseUrl}/api/embed`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: this.model, input: batch, keep_alive: '30m', truncate: true }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (err) {
        throw new LlmError(`Ollama embeddings unreachable at ${this.baseUrl} (${(err as Error).message})`, 'http', true)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        if (res.status === 404) throw new LlmError(`Embedding model "${this.model}" not pulled. Run: ollama pull ${this.model}`, 'config')
        throw new LlmError(`Ollama embed HTTP ${res.status}: ${text.slice(0, 200)}`, 'http', res.status >= 500)
      }
      const json = (await res.json()) as { embeddings?: number[][] }
      for (const e of json.embeddings ?? []) out.push(normalize(Float32Array.from(e)))
    }
    if (out.length !== texts.length) throw new LlmError('Ollama returned a different number of embeddings than inputs', 'parse', true)
    return out
  }
}

/** Deterministic test double: hashed bag-of-words vectors, so similar texts get similar vectors. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'fake'
  readonly model = 'fake-bow'
  readonly dims = 64
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(this.dims)
      for (const w of t.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean)) {
        let h = 2166136261
        for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619)
        v[Math.abs(h) % this.dims] += 1
      }
      return normalize(v)
    })
  }
}

/** Embeddings through the same compatible API (`/embeddings`). Switching models = full re-embed (vectors are keyed by model). */
export class OpenAICompatEmbeddingProvider implements EmbeddingProvider {
  readonly name: string
  readonly model: string
  readonly dims: number
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  constructor(private readonly opts: { preset: ProviderPreset; apiKey: string; model?: string; dims?: number; baseUrl?: string; fetchImpl?: typeof fetch }) {
    if (!opts.apiKey) throw new LlmError(`${opts.preset.keyEnv} is not set`, 'config')
    if (!opts.preset.embeddingModel && !opts.model) throw new LlmError(`${opts.preset.id} has no embedding model`, 'config')
    this.name = opts.preset.id
    this.model = opts.model ?? opts.preset.embeddingModel!
    this.dims = opts.dims ?? opts.preset.embeddingDims ?? 768
    this.baseUrl = (opts.baseUrl ?? opts.preset.baseUrl).replace(/\/$/, '')
    this.fetchImpl = opts.fetchImpl ?? fetch
  }
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return []
    const out: Float32Array[] = []
    for (let i = 0; i < texts.length; i += 64) {
      const batch = texts.slice(i, i + 64).map((t) => t.slice(0, 8000))
      let res: Response
      try {
        res = await this.fetchImpl(`${this.baseUrl}/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` }, body: JSON.stringify({ model: this.model, input: batch }), signal: AbortSignal.timeout(60_000) })
      } catch (err) { throw new LlmError(`${this.name} embeddings unreachable: ${(err as Error).message}`, 'http', true) }
      if (res.status === 429) throw new LlmError(`${this.name} embeddings rate limited`, 'budget')
      if (!res.ok) throw new LlmError(`${this.name} embeddings HTTP ${res.status}`, 'http', res.status >= 500)
      const json = (await res.json()) as { data?: Array<{ index: number; embedding: number[] }> }
      const rows = (json.data ?? []).sort((a, b) => a.index - b.index)
      for (const r of rows) out.push(normalize(Float32Array.from(r.embedding)))
    }
    if (out.length !== texts.length) throw new LlmError(`${this.name} returned ${out.length} embeddings for ${texts.length} inputs`, 'parse', true)
    return out
  }
}

/** EMBEDDING_PROVIDER = ollama (default) | gemini | openai | mistral | fake | none */
export function createEmbeddingProvider(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  const choice = (env.EMBEDDING_PROVIDER ?? 'ollama').toLowerCase()
  if (choice === 'none') return null
  if (choice === 'fake') return new FakeEmbeddingProvider()
  if (choice === 'ollama') return new OllamaEmbeddingProvider({ baseUrl: env.OLLAMA_BASE_URL, model: env.EMBEDDING_MODEL, dims: env.EMBEDDING_DIMS ? parseInt(env.EMBEDDING_DIMS, 10) : undefined })
  const preset = PRESETS[choice]
  if (preset && !env[preset.keyEnv]) { log.warn(`EMBEDDING_PROVIDER=${choice} but ${preset.keyEnv} is empty — embeddings off (keyword matching only) until the key is added`); return null }
  if (preset) return new OpenAICompatEmbeddingProvider({ preset, apiKey: env[preset.keyEnv] ?? '', model: env.EMBEDDING_MODEL && env.EMBEDDING_MODEL !== 'nomic-embed-text' ? env.EMBEDDING_MODEL : undefined, dims: env.EMBEDDING_DIMS && env.EMBEDDING_DIMS !== '768' ? parseInt(env.EMBEDDING_DIMS, 10) : undefined, baseUrl: env[`LLM_${choice.toUpperCase()}_BASE_URL`] })
  throw new LlmError(`Unknown EMBEDDING_PROVIDER "${choice}"`, 'config')
}
