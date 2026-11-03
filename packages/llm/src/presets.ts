/**
 * Hosted provider presets (docs/AI-PROVIDERS.md §2). Limits are the providers' published free-tier numbers at
 * the time of writing — verify before relying on them; override per install with LLM_<ID>_RPM / _RPD / _TPM.
 */
export type DataUse = 'local' | 'no-train' | 'may-train'

export interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  model: string
  embeddingModel?: string
  embeddingDims?: number
  keyEnv: string
  /** Structured output support: 'json_schema' (strict), 'json_object' (+ schema in prompt), 'prompt' (nothing; parse leniently). */
  structured: 'json_schema' | 'json_object' | 'prompt'
  /** Free-tier defaults; 0 = unknown/unlimited. Override with LLM_<ID>_RPM / LLM_<ID>_RPD. */
  rpm: number
  rpd: number
  /** Hard cap on tokens per minute (some free tiers); prompts are trimmed to stay under it. 0 = none. */
  tpm: number
  dataUse: DataUse
  /** USD per 1M tokens on the paid tier (metering only; free tiers cost 0 → set by `free`). */
  pricing: { input: number; output: number }
  docs: string
}

/** Limits are the providers' published free-tier numbers at the time of writing — verify before relying on them. */
export const PRESETS: Record<string, ProviderPreset> = {
  gemini: {
    id: 'gemini', label: 'Google Gemini (free tier)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash',
    embeddingModel: 'text-embedding-004', embeddingDims: 768, keyEnv: 'GEMINI_API_KEY', structured: 'json_schema', rpm: 15, rpd: 1500, tpm: 1_000_000,
    dataUse: 'may-train', pricing: { input: 0.1, output: 0.4 }, docs: 'https://ai.google.dev/gemini-api/docs/rate-limits',
  },
  groq: {
    id: 'groq', label: 'Groq (free tier)', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyEnv: 'GROQ_API_KEY',
    structured: 'json_object', rpm: 30, rpd: 1000, tpm: 12_000, dataUse: 'no-train', pricing: { input: 0.59, output: 0.79 }, docs: 'https://console.groq.com/docs/rate-limits',
  },
  cerebras: {
    id: 'cerebras', label: 'Cerebras (free tier)', baseUrl: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b', keyEnv: 'CEREBRAS_API_KEY',
    structured: 'json_schema', rpm: 30, rpd: 0, tpm: 60_000, dataUse: 'no-train', pricing: { input: 0.85, output: 1.2 }, docs: 'https://inference-docs.cerebras.ai/support/rate-limits',
  },
  mistral: {
    id: 'mistral', label: 'Mistral (Experiment plan)', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', embeddingModel: 'mistral-embed', embeddingDims: 1024,
    keyEnv: 'MISTRAL_API_KEY', structured: 'json_object', rpm: 60, rpd: 0, tpm: 500_000, dataUse: 'may-train', pricing: { input: 0.1, output: 0.3 }, docs: 'https://docs.mistral.ai/deployment/laplateforme/tier/',
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter (free models)', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', keyEnv: 'OPENROUTER_API_KEY',
    structured: 'json_object', rpm: 20, rpd: 50, tpm: 0, dataUse: 'may-train', pricing: { input: 0, output: 0 }, docs: 'https://openrouter.ai/docs/api-reference/limits',
  },
  openai: {
    id: 'openai', label: 'OpenAI (paid)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', embeddingModel: 'text-embedding-3-small', embeddingDims: 1536,
    keyEnv: 'OPENAI_API_KEY', structured: 'json_schema', rpm: 0, rpd: 0, tpm: 0, dataUse: 'no-train', pricing: { input: 0.15, output: 0.6 }, docs: 'https://platform.openai.com/docs/guides/rate-limits',
  },
}

/** Purposes whose prompts contain resume/profile text (PII even after masking). Public-input purposes are the rest. */
export const PII_PURPOSES = new Set(['parse_resume', 'suggest', 'headline', 'answers'])

